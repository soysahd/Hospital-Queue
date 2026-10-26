require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const { query, getConnection } = require('./db');
const seedDatabase = require('./seed');
const queueManager = require('./queueManager');
const { generateToken, requireAuth, requireRole } = require('./auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Seed DB on start
seedDatabase().catch(console.error);

// Real-time notification broadcaster
function broadcastQueueUpdate(sessionId, extra = {}) {
  io.emit('queue.updated', { sessionId, timestamp: new Date().toISOString(), ...extra });
  io.emit('eta.updated', { sessionId });
}

// =============================================================
// AUTHENTICATION & SESSION ENDPOINTS
// =============================================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password, expectedRole } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const users = await query('SELECT * FROM users WHERE username = ? AND status = "ACTIVE"', [username.trim()]);
    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials or inactive account.' });
    }

    const user = users[0];

    // Enforce role boundary if logging in via dedicated portal
    if (expectedRole && user.role !== expectedRole && !(expectedRole === 'admin' && user.role === 'admin')) {
      return res.status(403).json({
        error: `Unauthorized portal. This account has role '${user.role}' and cannot log in through the ${expectedRole} portal.`
      });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials. Incorrect password.' });
    }

    const token = generateToken(user);

    await query(`
      INSERT INTO audit_logs (id, actor_id, actor_role, action, target_type, target_id, details)
      VALUES (?, ?, ?, 'LOGIN', 'user', ?, ?)
    `, [uuidv4(), user.id, user.role, user.id, `User ${user.username} logged in successfully`]);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        role: user.role,
        doctorId: user.doctor_id,
        patientId: user.patient_id
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server authentication error.' });
  }
});

// Patient Self-Registration
app.post('/api/auth/register-patient', async (req, res) => {
  try {
    const { username, password, fullName, dob, gender, phone, email, bloodGroup, allergies, address } = req.body;
    if (!username || !password || !fullName || !phone) {
      return res.status(400).json({ error: 'Username, password, full name, and phone number are required.' });
    }

    // Check existing username
    const existingUsers = await query('SELECT id FROM users WHERE username = ?', [username.trim()]);
    if (existingUsers.length > 0) {
      return res.status(400).json({ error: 'Username is already taken. Please choose another.' });
    }

    const patientCount = (await query('SELECT COUNT(*) as count FROM patients'))[0].count;
    const hospitalNumber = `PAT-${String(patientCount + 1001).padStart(6, '0')}`;
    const patientId = `pat-${uuidv4().substring(0, 8)}`;
    const userId = `user-${patientId}`;

    const birthDate = dob || '1990-01-01';
    const patGender = gender || 'Other';

    // Insert Patient
    await query(`
      INSERT INTO patients (id, hospital_number, name, dob, gender, phone, blood_group, allergies, address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [patientId, hospitalNumber, fullName.trim(), birthDate, patGender, phone.trim(), bloodGroup || null, allergies || null, address || null]);

    // Insert Barcode
    await query(`
      INSERT INTO patient_barcodes (id, patient_id, barcode_value)
      VALUES (?, ?, ?)
    `, [uuidv4(), patientId, hospitalNumber]);

    // Insert User
    const passwordHash = await bcrypt.hash(password, 10);
    await query(`
      INSERT INTO users (id, username, email, phone, password_hash, full_name, role, patient_id)
      VALUES (?, ?, ?, ?, ?, ?, 'patient', ?)
    `, [userId, username.trim(), email || null, phone.trim(), passwordHash, fullName.trim(), patientId]);

    const newUser = {
      id: userId,
      username: username.trim(),
      full_name: fullName.trim(),
      role: 'patient',
      patient_id: patientId
    };

    const token = generateToken(newUser);

    // Initial Welcome Notification
    await query(`
      INSERT INTO notifications (id, patient_id, title, message, category)
      VALUES (?, ?, 'Welcome to Smart Hospital Care', ?, 'GENERAL')
    `, [uuidv4(), patientId, `Welcome ${fullName}! Your patient hospital ID is ${hospitalNumber}. You can now schedule doctor appointments.`]);

    await query(`
      INSERT INTO audit_logs (id, actor_id, actor_role, action, target_type, target_id, details)
      VALUES (?, ?, 'patient', 'REGISTER_SELF', 'patient', ?, ?)
    `, [uuidv4(), userId, patientId, `Patient ${fullName} registered online account (${username})`]);

    res.status(201).json({
      success: true,
      message: 'Account registered successfully!',
      token,
      user: {
        id: userId,
        username: username.trim(),
        fullName: fullName.trim(),
        role: 'patient',
        patientId,
        hospitalNumber
      }
    });
  } catch (err) {
    console.error('Patient registration error:', err);
    res.status(500).json({ error: err.message || 'Error creating patient account.' });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const users = await query('SELECT id, username, full_name, role, doctor_id, patient_id, created_at FROM users WHERE id = ?', [req.user.id]);
    if (users.length === 0) return res.status(404).json({ error: 'User account not found.' });
    const user = users[0];

    let doctorProfile = null;
    let patientProfile = null;

    if (user.doctor_id) {
      const docs = await query(`
        SELECT d.*, r.room_number, r.name as room_name, dept.name as department_name
        FROM doctors d
        LEFT JOIN rooms r ON d.current_room_id = r.id
        JOIN departments dept ON d.department_id = dept.id
        WHERE d.id = ?
      `, [user.doctor_id]);
      if (docs.length > 0) doctorProfile = docs[0];
    }

    if (user.patient_id) {
      const pats = await query('SELECT * FROM patients WHERE id = ?', [user.patient_id]);
      if (pats.length > 0) patientProfile = pats[0];
    }

    res.json({ user, doctor: doctorProfile, patient: patientProfile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  try {
    await query(`
      INSERT INTO audit_logs (id, actor_id, actor_role, action, target_type, target_id, details)
      VALUES (?, ?, ?, 'LOGOUT', 'user', ?, ?)
    `, [uuidv4(), req.user.id, req.user.role, req.user.id, `User ${req.user.username} logged out`]);
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================
// PATIENT PORTAL & MEDICAL HISTORY (Section 1.A, 1.B, 1.C, 1.D)
// =============================================================

// 1. Comprehensive Patient Dashboard Data
app.get('/api/patient/dashboard', requireAuth, requireRole('patient', 'admin'), async (req, res) => {
  try {
    const patientId = req.user.role === 'patient' ? req.user.patientId : (req.query.patientId || 'pat-001');
    if (!patientId) {
      return res.status(400).json({ error: 'No patient linked to this account.' });
    }

    const [patient] = await query('SELECT * FROM patients WHERE id = ?', [patientId]);
    if (!patient) return res.status(404).json({ error: 'Patient profile not found.' });

    // Appointments (upcoming & previous)
    const appointments = await query(`
      SELECT a.*, cs.session_name, cs.session_code, cs.session_date, d.name as doctor_name
      FROM appointments a
      JOIN clinic_sessions cs ON a.session_id = cs.id
      LEFT JOIN doctors d ON a.doctor_id = d.id
      WHERE a.patient_id = ?
      ORDER BY a.created_at DESC
    `, [patientId]);

    // Active Queue Token
    const activeTokens = await query(`
      SELECT qt.*, cs.session_name, cs.session_code, r.room_number, d.name as doctor_name
      FROM queue_tokens qt
      JOIN clinic_sessions cs ON qt.session_id = cs.id
      LEFT JOIN rooms r ON qt.room_id = r.id
      LEFT JOIN doctors d ON qt.doctor_id = d.id
      WHERE qt.patient_id = ? AND qt.status IN ('WAITING', 'ASSIGNED', 'CALLED', 'IN_CONSULTATION')
      ORDER BY qt.issued_at DESC
      LIMIT 1
    `, [patientId]);

    let eta = null;
    let activeToken = null;
    if (activeTokens.length > 0) {
      activeToken = activeTokens[0];
      eta = await queueManager.calculateETA(activeToken.session_id, activeToken.id);
    }

    // Care Tasks (Section 1.C)
    const careTasks = await query(`
      SELECT t.*, d.name as doctor_name
      FROM care_tasks t
      JOIN doctors d ON t.doctor_id = d.id
      WHERE t.patient_id = ?
      ORDER BY t.created_at DESC
    `, [patientId]);

    // Notifications (Section 1.D)
    const notifications = await query(`
      SELECT * FROM notifications 
      WHERE patient_id = ? 
      ORDER BY created_at DESC 
      LIMIT 20
    `, [patientId]);

    // Lab Requests & Results
    const labRequests = await query(`
      SELECT lr.*, d.name as doctor_name, c.diagnosis, u.full_name as verified_staff_name
      FROM lab_requests lr
      JOIN doctors d ON lr.doctor_id = d.id
      LEFT JOIN consultations c ON lr.consultation_id = c.id
      LEFT JOIN users u ON lr.verified_by = u.id
      WHERE lr.patient_id = ?
      ORDER BY lr.created_at DESC
    `, [patientId]);

    res.json({
      patient,
      activeToken,
      eta,
      appointments,
      careTasks,
      notifications,
      labRequests
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Patient Action: Mark Care Task Completed (Section 1.C)
// Rules: Patient marks it as PATIENT_MARKED_COMPLETED / AWAITING_VERIFICATION; never verified result.
app.post('/api/patient/tasks/:taskId/mark-completed', requireAuth, requireRole('patient', 'admin'), async (req, res) => {
  try {
    const taskId = req.params.taskId;
    const patientId = req.user.role === 'patient' ? req.user.patientId : null;

    let sql = 'SELECT * FROM care_tasks WHERE id = ?';
    let params = [taskId];
    if (patientId) {
      sql += ' AND patient_id = ?';
      params.push(patientId);
    }

    const tasks = await query(sql, params);
    if (tasks.length === 0) {
      return res.status(404).json({ error: 'Task not found or access denied.' });
    }

    const task = tasks[0];
    if (task.status === 'VERIFIED_COMPLETED') {
      return res.status(400).json({ error: 'This task has already been verified and completed.' });
    }

    // Advance status to PATIENT_MARKED_COMPLETED
    await query(`
      UPDATE care_tasks 
      SET status = 'PATIENT_MARKED_COMPLETED', completed_at = NOW() 
      WHERE id = ?
    `, [taskId]);

    // Audit trail (Section 1.C requirement)
    await query(`
      INSERT INTO audit_logs (id, actor_id, actor_role, action, target_type, target_id, details)
      VALUES (?, ?, ?, 'PATIENT_MARK_TASK', 'care_task', ?, ?)
    `, [uuidv4(), req.user.id, req.user.role, taskId, `Patient marked task '${task.title}' as completed (awaiting verification)`]);

    // In-app notification
    await query(`
      INSERT INTO notifications (id, patient_id, title, message, category, reference_id)
      VALUES (?, ?, 'Task Status Updated', ?, 'CARE_TASK', ?)
    `, [uuidv4(), task.patient_id, `You marked '${task.title}' as attended. Awaiting clinical verification.`, taskId]);

    res.json({
      success: true,
      message: 'Task successfully marked as completed by patient. Awaiting staff verification.',
      newStatus: 'PATIENT_MARKED_COMPLETED'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Mark Notification as Read (Section 1.D)
app.post('/api/patient/notifications/:id/read', requireAuth, requireRole('patient', 'admin'), async (req, res) => {
  try {
    await query('UPDATE notifications SET is_read = 1 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Longitudinal Patient Medical History (Doctor authorized or Patient's Own)
app.get('/api/patients/:id/history', requireAuth, async (req, res) => {
  try {
    const patientId = req.params.id;

    // Strict privacy boundary (Section 1.A & 1.B)
    if (req.user.role === 'patient' && req.user.patientId !== patientId) {
      return res.status(403).json({ error: 'Access denied. You can only view your own medical records.' });
    }

    const data = await queueManager.getPatientHistory(patientId);
    if (!data) return res.status(404).json({ error: 'Patient records not found.' });

    // Include care tasks & lab reports in chronological history
    const tasks = await query('SELECT * FROM care_tasks WHERE patient_id = ? ORDER BY created_at DESC', [patientId]);
    const labRequests = await query('SELECT * FROM lab_requests WHERE patient_id = ? ORDER BY created_at DESC', [patientId]);

    await query(`
      INSERT INTO audit_logs (id, actor_id, actor_role, action, target_type, target_id, details)
      VALUES (?, ?, ?, 'VIEW_HISTORY', 'patient', ?, ?)
    `, [uuidv4(), req.user.id, req.user.role, patientId, `Viewed longitudinal clinical history for patient ${patientId}`]);

    res.json({
      ...data,
      careTasks: tasks,
      allLabRequests: labRequests
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================
// DOCTOR CONSOLE & BARCODE SCANNER (Section 2.A, 2.B, 2.C)
// =============================================================

// Doctor Barcode Scan to Open Patient Encounter (Section 2.A)
app.post('/api/doctor/scan-token', requireAuth, requireRole('doctor', 'admin'), async (req, res) => {
  try {
    const { barcode } = req.body;
    if (!barcode) return res.status(400).json({ error: 'Token barcode is required.' });

    const trimmed = barcode.trim();
    // Validate barcode against backend
    const tokens = await query(`
      SELECT qt.*, p.name as patient_name, p.hospital_number, p.dob, p.gender, p.blood_group, p.allergies,
             cs.session_name, cs.session_code, r.room_number, d.name as doctor_name
      FROM queue_tokens qt
      JOIN patients p ON qt.patient_id = p.id
      JOIN clinic_sessions cs ON qt.session_id = cs.id
      LEFT JOIN rooms r ON qt.room_id = r.id
      LEFT JOIN doctors d ON qt.doctor_id = d.id
      WHERE qt.token_number = ? OR qt.id = ?
      LIMIT 1
    `, [trimmed, trimmed]);

    if (tokens.length === 0) {
      return res.status(404).json({ error: 'Invalid or unassigned queue token barcode.' });
    }

    const token = tokens[0];
    const patientHistory = await queueManager.getPatientHistory(token.patient_id);
    const careTasks = await query('SELECT * FROM care_tasks WHERE patient_id = ? ORDER BY created_at DESC', [token.patient_id]);

    // Audit barcode encounter scan
    await query(`
      INSERT INTO audit_logs (id, actor_id, actor_role, action, target_type, target_id, details)
      VALUES (?, ?, 'doctor', 'SCAN_TOKEN_BARCODE', 'queue_token', ?, ?)
    `, [uuidv4(), req.user.id, token.id, `Doctor scanned token barcode ${token.token_number} for patient ${token.patient_name}`]);

    res.json({
      success: true,
      token,
      patient: patientHistory.patient,
      history: patientHistory.history,
      careTasks
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Doctor Call Next Patient (Atomic Concurrency)
app.post('/api/queues/next', requireAuth, requireRole('doctor', 'admin'), async (req, res) => {
  try {
    let doctorId = req.user.role === 'doctor' ? req.user.doctorId : req.body.doctorId;
    if (!doctorId) return res.status(400).json({ error: 'Doctor ID is required.' });

    const result = await queueManager.callNextPatient(doctorId);

    if (result.success && result.token) {
      io.emit('token.called', {
        tokenNumber: result.token.token_number,
        roomNumber: result.token.room_number,
        doctorName: result.token.doctor_name,
        sessionId: result.token.session_id
      });
      broadcastQueueUpdate(result.token.session_id);
    }

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Complete Consultation & Record Notes, Prescriptions, Labs, Recommendations (Section 2.B)
app.post('/api/consultations', requireAuth, requireRole('doctor', 'admin'), async (req, res) => {
  try {
    const {
      tokenId,
      symptoms,
      diagnosis,
      clinicalNotes,
      recommendations,
      followUpAdvice,
      prescriptions,
      labs,
      tasks
    } = req.body;
    let doctorId = req.user.role === 'doctor' ? req.user.doctorId : req.body.doctorId;

    if (!tokenId || !doctorId) {
      return res.status(400).json({ error: 'Token ID and Doctor ID are required.' });
    }

    const result = await queueManager.completeConsultation({
      tokenId,
      doctorId,
      symptoms,
      diagnosis,
      clinicalNotes,
      recommendations,
      followUpAdvice,
      prescriptions,
      labs,
      tasks
    });

    broadcastQueueUpdate(null);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Recall Patient Chime
app.post('/api/tokens/:id/recall', requireAuth, requireRole('doctor', 'admin'), async (req, res) => {
  try {
    const tokenId = req.params.id;
    let doctorId = req.user.role === 'doctor' ? req.user.doctorId : req.body.doctorId;

    const token = await queueManager.recallPatient(tokenId, doctorId);

    io.emit('token.called', {
      tokenNumber: token.token_number,
      roomNumber: token.room_number,
      doctorName: token.doctor_name,
      isRecall: true,
      sessionId: token.session_id
    });
    broadcastQueueUpdate(token.session_id);

    res.json({ success: true, token });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Mark Missed
app.post('/api/tokens/:id/missed', requireAuth, requireRole('doctor', 'admin'), async (req, res) => {
  try {
    const tokenId = req.params.id;
    let doctorId = req.user.role === 'doctor' ? req.user.doctorId : req.body.doctorId;
    const { reason } = req.body;

    await queueManager.markMissed(tokenId, doctorId, reason);
    broadcastQueueUpdate(null);
    res.json({ success: true, message: 'Patient marked as missed.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Doctor Current Queue State (Synchronized state & countdown recovery)
app.get('/api/doctor/state', requireAuth, requireRole('doctor', 'admin'), async (req, res) => {
  try {
    const doctorId = req.query.doctorId || (req.user.role === 'doctor' ? req.user.doctorId : null);
    if (!doctorId) return res.status(400).json({ error: 'Doctor ID is required.' });

    const state = await queueManager.getDoctorCurrentState(doctorId);
    res.json({ success: true, ...state });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Doctor Mark Patient Arrived
app.post('/api/tokens/:id/arrived', requireAuth, requireRole('doctor', 'admin'), async (req, res) => {
  try {
    const tokenId = req.params.id;
    const doctorId = req.user.role === 'doctor' ? req.user.doctorId : req.body.doctorId;

    const token = await queueManager.markPatientArrived(tokenId, doctorId);
    broadcastQueueUpdate(token.session_id);
    io.emit('queue.doctor_updated', { doctorId, status: 'ARRIVED', tokenNumber: token.token_number });
    res.json({ success: true, token });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Doctor Start Consultation
app.post('/api/tokens/:id/start-consultation', requireAuth, requireRole('doctor', 'admin'), async (req, res) => {
  try {
    const tokenId = req.params.id;
    const doctorId = req.user.role === 'doctor' ? req.user.doctorId : req.body.doctorId;

    const token = await queueManager.startConsultation(tokenId, doctorId);
    broadcastQueueUpdate(token.session_id);
    io.emit('queue.doctor_updated', { doctorId, status: 'IN_CONSULTATION', tokenNumber: token.token_number });
    res.json({ success: true, token });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Doctor Skip Patient (Never delete history)
app.post('/api/tokens/:id/skip', requireAuth, requireRole('doctor', 'admin'), async (req, res) => {
  try {
    const tokenId = req.params.id;
    const doctorId = req.user.role === 'doctor' ? req.user.doctorId : req.body.doctorId;
    const { reason } = req.body;

    const result = await queueManager.skipPatient(tokenId, doctorId, reason);
    broadcastQueueUpdate(null);
    io.emit('queue.doctor_updated', { doctorId, status: 'SKIPPED' });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Doctor Recall Skipped or Awaiting Patient
app.post('/api/tokens/:id/recall-skipped', requireAuth, requireRole('doctor', 'admin'), async (req, res) => {
  try {
    const tokenId = req.params.id;
    const doctorId = req.user.role === 'doctor' ? req.user.doctorId : req.body.doctorId;

    const token = await queueManager.recallSkippedPatient(tokenId, doctorId);
    io.emit('token.called', {
      tokenNumber: token.token_number,
      roomNumber: token.room_number,
      doctorName: token.doctor_name,
      isRecall: true,
      sessionId: token.session_id
    });
    broadcastQueueUpdate(token.session_id);
    res.json({ success: true, token });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Expire 60s Countdown (Transition to AWAITING_PATIENT)
app.post('/api/tokens/:id/awaiting', requireAuth, requireRole('doctor', 'admin'), async (req, res) => {
  try {
    const tokenId = req.params.id;
    const doctorId = req.user.role === 'doctor' ? req.user.doctorId : req.body.doctorId;

    const token = await queueManager.markAwaitingPatient(tokenId, doctorId);
    broadcastQueueUpdate(token.session_id);
    res.json({ success: true, token });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// =============================================================
// LABORATORY WORKFLOW & RESULT VERIFICATION (Section 4)
// =============================================================

// List pending laboratory requests
app.get('/api/lab/requests', requireAuth, requireRole('lab', 'admin', 'doctor'), async (req, res) => {
  try {
    const requests = await query(`
      SELECT lr.*, p.name as patient_name, p.hospital_number, d.name as doctor_name
      FROM lab_requests lr
      JOIN patients p ON lr.patient_id = p.id
      JOIN doctors d ON lr.doctor_id = d.id
      ORDER BY lr.created_at DESC
    `);
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Enter and Release Verified Lab Results (Section 4)
app.post('/api/lab/requests/:id/release-result', requireAuth, requireRole('lab', 'admin'), async (req, res) => {
  try {
    const reqId = req.params.id;
    const { results, status = 'RESULT_RELEASED' } = req.body;
    if (!results) return res.status(400).json({ error: 'Laboratory results text is required.' });

    const requests = await query('SELECT * FROM lab_requests WHERE id = ?', [reqId]);
    if (requests.length === 0) return res.status(404).json({ error: 'Lab request not found.' });
    const labReq = requests[0];

    // Update lab request with verified results
    await query(`
      UPDATE lab_requests 
      SET results = ?, status = ?, verified_by = ?, verified_at = NOW()
      WHERE id = ?
    `, [results, status, req.user.id, reqId]);

    // If associated care task exists, mark as VERIFIED_COMPLETED
    await query(`
      UPDATE care_tasks 
      SET status = 'VERIFIED_COMPLETED', verified_by = ?, verified_at = NOW()
      WHERE lab_request_id = ?
    `, [req.user.id, reqId]);

    // Notify patient
    await query(`
      INSERT INTO notifications (id, patient_id, title, message, category, reference_id)
      VALUES (?, ?, 'Lab Results Released', ?, 'LAB_RESULT', ?)
    `, [uuidv4(), labReq.patient_id, `Your laboratory test results for ${labReq.test_name} have been released and verified.`, reqId]);

    // Audit log
    await query(`
      INSERT INTO audit_logs (id, actor_id, actor_role, action, target_type, target_id, details)
      VALUES (?, ?, 'lab', 'RELEASE_LAB_RESULT', 'lab_request', ?, ?)
    `, [uuidv4(), req.user.id, reqId, `Released verified lab results for ${labReq.test_name}`]);

    res.json({ success: true, message: 'Laboratory result verified and released successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================
// ADMIN DASHBOARD & HOSPITAL OPERATIONS (Section 3)
// =============================================================

// Comprehensive hospital statistics (Section 3.D)
app.get('/api/system-stats', async (req, res) => {
  try {
    const totalPatients = (await query('SELECT COUNT(*) as c FROM patients'))[0].c;
    const appointmentsToday = (await query('SELECT COUNT(*) as c FROM appointments WHERE DATE(created_at) = CURDATE()'))[0].c;
    const activeWaiting = (await query("SELECT COUNT(*) as c FROM queue_tokens WHERE status = 'WAITING'"))[0].c;
    const inService = (await query("SELECT COUNT(*) as c FROM queue_tokens WHERE status IN ('CALLED', 'IN_CONSULTATION')"))[0].c;
    const completedToday = (await query("SELECT COUNT(*) as c FROM queue_tokens WHERE status = 'COMPLETED'"))[0].c;
    const doctorsOnDuty = (await query("SELECT COUNT(*) as c FROM doctors WHERE duty_status = 'ON_DUTY'"))[0].c;
    const pendingLabs = (await query("SELECT COUNT(*) as c FROM lab_requests WHERE status != 'RESULT_RELEASED'"))[0].c;
    const outstandingTasks = (await query("SELECT COUNT(*) as c FROM care_tasks WHERE status NOT IN ('VERIFIED_COMPLETED', 'CANCELLED')"))[0].c;
    const recentLogs = await query('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 20');

    res.json({
      totalPatients,
      appointmentsToday,
      activeWaiting,
      inService,
      completedToday,
      doctorsOnDuty,
      pendingLabs,
      outstandingTasks,
      recentLogs
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Appointment Management (Section 3.C)
app.get('/api/admin/appointments', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const list = await query(`
      SELECT a.*, p.name as patient_name, p.hospital_number, cs.session_name, cs.session_code, d.name as doctor_name
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      JOIN clinic_sessions cs ON a.session_id = cs.id
      LEFT JOIN doctors d ON a.doctor_id = d.id
      ORDER BY a.created_at DESC
    `);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cancel or Reschedule Appointment (Section 3.C)
app.post('/api/admin/appointments/:id/update-status', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const apptId = req.params.id;
    const { status, reason, scheduledTime, doctorId } = req.body;

    let sql = 'UPDATE appointments SET status = ?';
    let params = [status];

    if (reason) {
      sql += ', cancellation_reason = ?';
      params.push(reason);
    }
    if (scheduledTime) {
      sql += ', scheduled_time = ?';
      params.push(scheduledTime);
    }
    if (doctorId) {
      sql += ', doctor_id = ?';
      params.push(doctorId);
    }
    sql += ' WHERE id = ?';
    params.push(apptId);

    await query(sql, params);

    const [appt] = await query('SELECT * FROM appointments WHERE id = ?', [apptId]);
    if (appt) {
      // Notify patient of appointment update
      await query(`
        INSERT INTO notifications (id, patient_id, title, message, category, reference_id)
        VALUES (?, ?, 'Appointment Update', ?, 'APPOINTMENT', ?)
      `, [uuidv4(), appt.patient_id, `Your appointment (${appt.reference}) status was updated to ${status}. ${reason ? 'Reason: ' + reason : ''}`, apptId]);
    }

    res.json({ success: true, message: 'Appointment updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Patient Personal Information Update (Section 3.A)
app.post('/api/admin/patients/:id/update-profile', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const patientId = req.params.id;
    const { name, phone, address, bloodGroup, allergies } = req.body;

    await query(`
      UPDATE patients 
      SET name = COALESCE(?, name),
          phone = COALESCE(?, phone),
          address = COALESCE(?, address),
          blood_group = COALESCE(?, blood_group),
          allergies = COALESCE(?, allergies)
      WHERE id = ?
    `, [name, phone, address, bloodGroup, allergies, patientId]);

    await query(`
      INSERT INTO audit_logs (id, actor_id, actor_role, action, target_type, target_id, details)
      VALUES (?, ?, 'admin', 'UPDATE_PATIENT_PROFILE', 'patient', ?, ?)
    `, [uuidv4(), req.user.id, patientId, `Admin updated personal details for patient ${patientId}`]);

    res.json({ success: true, message: 'Patient profile updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Register New Patient (Section 3.A)
app.post('/api/admin/patients', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { name, dob, gender, phone, bloodGroup, allergies, address } = req.body;
    if (!name || !dob || !gender || !phone) {
      return res.status(400).json({ error: 'Name, date of birth, gender, and phone number are required.' });
    }

    const patientCount = (await query('SELECT COUNT(*) as count FROM patients'))[0].count;
    const nextHospitalNumber = `PAT-${String(patientCount + 125).padStart(6, '0')}`;
    const patientId = `pat-${uuidv4().substring(0, 8)}`;

    await query(`
      INSERT INTO patients (id, hospital_number, name, dob, gender, phone, blood_group, allergies, address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [patientId, nextHospitalNumber, name, dob, gender, phone, bloodGroup || null, allergies || null, address || null]);

    // Create barcode
    await query(`
      INSERT INTO patient_barcodes (id, patient_id, barcode_value)
      VALUES (?, ?, ?)
    `, [uuidv4(), patientId, nextHospitalNumber]);

    // Create patient login account
    const username = `pat_${nextHospitalNumber.toLowerCase().replace('-', '_')}`;
    const defaultPasswordHash = await bcrypt.hash('Patient@123', 10);
    await query(`
      INSERT INTO users (id, username, password_hash, full_name, role, patient_id)
      VALUES (?, ?, ?, ?, 'patient', ?)
    `, [`user-${patientId}`, username, defaultPasswordHash, name, patientId]);

    await query(`
      INSERT INTO audit_logs (id, actor_id, actor_role, action, target_type, target_id, details)
      VALUES (?, ?, 'admin', 'REGISTER_PATIENT', 'patient', ?, ?)
    `, [uuidv4(), req.user.id, patientId, `Admin registered new patient ${name} (${nextHospitalNumber})`]);

    res.json({
      success: true,
      message: 'Patient registered successfully.',
      patient: { id: patientId, hospital_number: nextHospitalNumber, name, username }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Doctor Request Personal Information Correction to Admin (Section 2.C)
app.post('/api/doctor/request-patient-info-correction', requireAuth, requireRole('doctor'), async (req, res) => {
  try {
    const { patientId, proposedCorrection, reason } = req.body;
    if (!patientId || !proposedCorrection) {
      return res.status(400).json({ error: 'Patient ID and proposed correction are required.' });
    }

    const [patient] = await query('SELECT * FROM patients WHERE id = ?', [patientId]);
    if (!patient) return res.status(404).json({ error: 'Patient not found.' });

    // Log the request in audit logs for administrator action
    await query(`
      INSERT INTO audit_logs (id, actor_id, actor_role, action, target_type, target_id, details)
      VALUES (?, ?, 'doctor', 'REQUEST_PROFILE_CORRECTION', 'patient', ?, ?)
    `, [
      uuidv4(),
      req.user.id,
      patientId,
      `Correction request submitted by ${req.user.fullName} for patient ${patient.name} (${patient.hospital_number}): ${proposedCorrection}. Reason: ${reason || 'Clinical verification required'}`
    ]);

    res.json({
      success: true,
      message: 'Correction request submitted to hospital administration for verification.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Doctor Duty & Room Status (Section 3.B)
app.post('/api/admin/doctor-duty', requireAuth, requireRole('admin', 'doctor'), async (req, res) => {
  try {
    const { doctorId, dutyStatus, roomId } = req.body;
    if (!doctorId) return res.status(400).json({ error: 'Doctor ID is required.' });

    let sql = 'UPDATE doctors SET duty_status = ?';
    const params = [dutyStatus];
    if (roomId) {
      sql += ', current_room_id = ?';
      params.push(roomId);
    }
    sql += ' WHERE id = ?';
    params.push(doctorId);

    await query(sql, params);

    io.emit('doctor.status_changed', { doctorId, dutyStatus, roomId });
    broadcastQueueUpdate(null);

    res.json({ success: true, message: 'Doctor duty status updated.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// =============================================================
// RECEPTION & GENERAL APPOINTMENTS
// =============================================================
app.post('/api/patients/lookup-barcode', async (req, res) => {
  try {
    const { barcode } = req.body;
    if (!barcode) return res.status(400).json({ error: 'Barcode or Patient ID is required.' });

    const result = await queueManager.lookupPatientByBarcode(barcode);
    if (!result) return res.status(404).json({ error: 'Patient not found for the scanned card.' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/visits/check-in', async (req, res) => {
  try {
    const { patientId, sessionId, priority, isAppointment, appointmentRef } = req.body;
    if (!patientId || !sessionId) return res.status(400).json({ error: 'Patient and Session are required.' });

    const result = await queueManager.issueToken({
      patientId,
      sessionId,
      priority: Number(priority) || 1,
      isAppointment: !!isAppointment,
      appointmentRef,
      actorId: 'reception_counter'
    });

    broadcastQueueUpdate(sessionId, { tokenNumber: result.token.token_number });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/tokens/lookup/:tokenRef', async (req, res) => {
  try {
    const tokenRef = req.params.tokenRef.trim();
    const rows = await query(`
      SELECT qt.*, p.name as patient_name, p.hospital_number, cs.session_name, cs.session_code, r.room_number, d.name as doctor_name
      FROM queue_tokens qt
      JOIN patients p ON qt.patient_id = p.id
      JOIN clinic_sessions cs ON qt.session_id = cs.id
      LEFT JOIN rooms r ON qt.room_id = r.id
      LEFT JOIN doctors d ON qt.doctor_id = d.id
      WHERE qt.token_number = ? OR qt.id = ?
      LIMIT 1
    `, [tokenRef, tokenRef]);

    if (rows.length === 0) return res.status(404).json({ error: 'Queue token not found.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tokens/:id/reprint', async (req, res) => {
  try {
    await queueManager.recordReprint(req.params.id, 'receptionist');
    res.json({ success: true, message: 'Reprint recorded in audit log.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// =============================================================
// DOCTOR WORKING SCHEDULE & APPOINTMENT BOOKING ENGINE
// =============================================================

// Helper: generate 15-min or custom-duration slot times between startTime and endTime
function generateSlots(startTime, endTime, breakStart, breakEnd, durationMinutes = 15) {
  const slots = [];
  const toMinutes = (timeStr) => {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  };
  const toTimeString = (mins) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const startMin = toMinutes(startTime);
  const endMin = toMinutes(endTime);
  const bStartMin = breakStart ? toMinutes(breakStart) : -1;
  const bEndMin = breakEnd ? toMinutes(breakEnd) : -1;

  for (let current = startMin; current + durationMinutes <= endMin; current += durationMinutes) {
    // Check if slot falls in break
    if (bStartMin !== -1 && bEndMin !== -1) {
      if (current >= bStartMin && current < bEndMin) {
        continue;
      }
    }
    slots.push(toTimeString(current));
  }
  return slots;
}

// 1. Public / Patient: Get available dates for appointment booking
app.get('/api/appointments/available-dates', async (req, res) => {
  try {
    const { departmentId, doctorId } = req.query;
    let sql = `
      SELECT DISTINCT ds.schedule_date
      FROM doctor_schedules ds
      JOIN doctors d ON ds.doctor_id = d.id
      WHERE ds.schedule_date >= CURDATE()
        AND ds.is_published = 1
        AND ds.booking_disabled = 0
        AND ds.status = 'AVAILABLE'
    `;
    const params = [];
    if (departmentId) {
      sql += ' AND d.department_id = ?';
      params.push(departmentId);
    }
    if (doctorId) {
      sql += ' AND ds.doctor_id = ?';
      params.push(doctorId);
    }
    sql += ' ORDER BY ds.schedule_date ASC LIMIT 60';

    const rows = await query(sql, params);
    const dates = rows.map(r => r.schedule_date instanceof Date ? r.schedule_date.toISOString().split('T')[0] : String(r.schedule_date));
    res.json({ success: true, dates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Public / Patient: Get scheduled doctors for a specific date & department
app.get('/api/appointments/scheduled-doctors', async (req, res) => {
  try {
    const { date, departmentId } = req.query;
    if (!date) return res.status(400).json({ error: 'Date is required.' });

    let sql = `
      SELECT ds.*, d.name as doctor_name, d.specialization, d.profile_image,
             dept.id as department_id, dept.name as department_name,
             r.room_number, r.name as room_name,
             (SELECT COUNT(*) FROM appointments a 
              WHERE a.doctor_id = ds.doctor_id 
                AND a.appointment_date = ds.schedule_date 
                AND a.status NOT IN ('CANCELLED', 'MISSED')) as booked_count
      FROM doctor_schedules ds
      JOIN doctors d ON ds.doctor_id = d.id
      JOIN departments dept ON d.department_id = dept.id
      LEFT JOIN rooms r ON ds.room_id = r.id
      WHERE ds.schedule_date = ?
        AND ds.is_published = 1
        AND ds.booking_disabled = 0
        AND ds.status = 'AVAILABLE'
    `;
    const params = [date];
    if (departmentId) {
      sql += ' AND d.department_id = ?';
      params.push(departmentId);
    }
    sql += ' ORDER BY d.name ASC';

    const schedules = await query(sql, params);

    // Filter to only doctors who have not exceeded max_capacity
    const availableDoctors = schedules.filter(s => (s.booked_count || 0) < (s.max_capacity || 30)).map(s => ({
      scheduleId: s.id,
      doctorId: s.doctor_id,
      doctorName: s.doctor_name,
      specialization: s.specialization,
      departmentId: s.department_id,
      departmentName: s.department_name,
      profileImage: s.profile_image,
      roomNumber: s.room_number || 'Room TBD',
      workingHours: `${s.start_time} - ${s.end_time}`,
      breakHours: s.break_start ? `${s.break_start} - ${s.break_end}` : null,
      hospitalBranch: s.hospital_branch,
      appointmentDuration: s.appointment_duration || 15,
      capacity: s.max_capacity,
      bookedCount: s.booked_count,
      availableSlotsCount: Math.max(0, s.max_capacity - s.booked_count)
    }));

    res.json({ success: true, doctors: availableDoctors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Public / Patient: Get available time slots for a doctor on a specific date
app.get('/api/appointments/available-slots', async (req, res) => {
  try {
    const { doctorId, date } = req.query;
    if (!doctorId || !date) return res.status(400).json({ error: 'Doctor ID and Date are required.' });

    const schedules = await query(`
      SELECT * FROM doctor_schedules
      WHERE doctor_id = ? AND schedule_date = ? AND is_published = 1 AND booking_disabled = 0 AND status = 'AVAILABLE'
      LIMIT 1
    `, [doctorId, date]);

    if (schedules.length === 0) {
      return res.status(404).json({ error: 'No active published schedule found for this doctor on selected date.' });
    }

    const schedule = schedules[0];
    const duration = schedule.appointment_duration || 15;
    const allSlots = generateSlots(schedule.start_time, schedule.end_time, schedule.break_start, schedule.break_end, duration);

    // Get existing bookings for this doctor & date
    const bookedRows = await query(`
      SELECT scheduled_time FROM appointments
      WHERE doctor_id = ? AND appointment_date = ? AND status NOT IN ('CANCELLED', 'MISSED')
    `, [doctorId, date]);

    const bookedTimes = new Set(bookedRows.map(r => r.scheduled_time));

    // Also if date is today, disable past time slots
    const todayStr = new Date().toISOString().split('T')[0];
    const isToday = (date === todayStr);
    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();

    const slotsWithAvailability = allSlots.map(timeStr => {
      const [h, m] = timeStr.split(':').map(Number);
      const isPast = isToday && (h * 60 + m <= currentMins);
      const isBooked = bookedTimes.has(timeStr);
      return {
        time: timeStr,
        available: !isBooked && !isPast,
        reason: isBooked ? 'Booked' : (isPast ? 'Past Time' : 'Available')
      };
    });

    res.json({
      success: true,
      schedule: {
        id: schedule.id,
        doctorId: schedule.doctor_id,
        date: schedule.schedule_date,
        branch: schedule.hospital_branch,
        duration,
        startTime: schedule.start_time,
        endTime: schedule.end_time
      },
      slots: slotsWithAvailability
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Secure Patient Appointment Booking (Requires Auth)
app.post('/api/appointments/book', requireAuth, requireRole('patient', 'admin'), async (req, res) => {
  const conn = await getConnection();
  await conn.beginTransaction();

  try {
    const { doctorId, appointmentDate, scheduledTime, departmentId, notes } = req.body;
    let patientId = req.user.role === 'patient' ? req.user.patientId : req.body.patientId;

    if (!patientId) {
      await conn.rollback();
      return res.status(400).json({ error: 'Patient profile is required to book an appointment.' });
    }
    if (!doctorId || !appointmentDate || !scheduledTime) {
      await conn.rollback();
      return res.status(400).json({ error: 'Doctor, date, and appointment time slot are required.' });
    }

    // Lock schedule row to verify availability
    const [schedules] = await conn.execute(`
      SELECT * FROM doctor_schedules 
      WHERE doctor_id = ? AND schedule_date = ? AND is_published = 1 AND booking_disabled = 0 AND status = 'AVAILABLE'
      FOR UPDATE
    `, [doctorId, appointmentDate]);

    if (schedules.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'Doctor is not scheduled or available for booking on this date.' });
    }
    const schedule = schedules[0];

    // Check concurrency: Ensure slot is NOT already booked
    const [existingBookings] = await conn.execute(`
      SELECT id FROM appointments 
      WHERE doctor_id = ? AND appointment_date = ? AND scheduled_time = ? AND status NOT IN ('CANCELLED', 'MISSED')
      FOR UPDATE
    `, [doctorId, appointmentDate, scheduledTime]);

    if (existingBookings.length > 0) {
      await conn.rollback();
      return res.status(409).json({ error: 'This time slot has just been booked by another patient. Please select an alternate time.' });
    }

    // Check capacity limit
    const [countRows] = await conn.execute(`
      SELECT COUNT(*) as booked FROM appointments 
      WHERE doctor_id = ? AND appointment_date = ? AND status NOT IN ('CANCELLED', 'MISSED')
      FOR UPDATE
    `, [doctorId, appointmentDate]);

    if (countRows[0].booked >= schedule.max_capacity) {
      await conn.rollback();
      return res.status(400).json({ error: 'This doctor has reached the maximum appointment capacity for the selected date.' });
    }

    // Resolve or find active clinic session for this doctor
    const [doctorRows] = await conn.execute(`
      SELECT d.*, c.id as clinic_id, cs.id as session_id 
      FROM doctors d
      LEFT JOIN clinics c ON d.department_id = c.department_id
      LEFT JOIN clinic_sessions cs ON cs.clinic_id = c.id AND cs.session_date = ?
      WHERE d.id = ?
    `, [appointmentDate, doctorId]);

    const doc = doctorRows[0];
    let sessionId = doc ? doc.session_id : null;

    if (!sessionId) {
      // Create session for date if not already existing
      sessionId = `session-${doc.department_id}-${appointmentDate}`;
      await conn.execute(`
        INSERT INTO clinic_sessions (id, clinic_id, session_name, session_code, session_date, start_time, end_time, capacity, state)
        VALUES (?, ?, ?, 'OPD', ?, '08:00', '18:00', 300, 'ACTIVE')
        ON DUPLICATE KEY UPDATE state = 'ACTIVE'
      `, [sessionId, doc.clinic_id || 'clinic-opd-01', `Clinical Session ${appointmentDate}`, appointmentDate]);
    }

    // Generate unique reference
    const [seqRows] = await conn.execute('SELECT COUNT(*) as count FROM appointments');
    const seq = (seqRows[0].count || 0) + 1;
    const cleanDate = appointmentDate.replace(/-/g, '');
    const reference = `APT-${cleanDate}-${String(seq).padStart(4, '0')}`;
    const appointmentId = uuidv4();

    await conn.execute(`
      INSERT INTO appointments (
        id, reference, patient_id, session_id, appointment_date, doctor_id,
        doctor_schedule_id, source, status, scheduled_time, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'MOBILE', 'APPOINTED', ?, NOW())
    `, [appointmentId, reference, patientId, sessionId, appointmentDate, doctorId, schedule.id, scheduledTime]);

    // Send confirmation notification to patient
    await conn.execute(`
      INSERT INTO notifications (id, patient_id, title, message, category, reference_id)
      VALUES (?, ?, 'Appointment Confirmed', ?, 'APPOINTMENT', ?)
    `, [
      uuidv4(),
      patientId,
      `Your appointment (${reference}) with ${doc.name} is confirmed for ${appointmentDate} at ${scheduledTime} in ${schedule.room_id ? 'Assigned Room' : 'Consultation Suite'}.`,
      appointmentId
    ]);

    await conn.execute(`
      INSERT INTO audit_logs (id, actor_id, actor_role, action, target_type, target_id, details)
      VALUES (?, ?, ?, 'BOOK_APPOINTMENT', 'appointment', ?, ?)
    `, [uuidv4(), req.user.id, req.user.role, appointmentId, `Patient booked appointment ${reference} for ${appointmentDate} ${scheduledTime}`]);

    await conn.commit();

    // Broadcast appointment update to real-time subscribers
    io.emit('appointment.booked', {
      appointmentId,
      reference,
      doctorId,
      date: appointmentDate,
      time: scheduledTime
    });

    res.status(201).json({
      success: true,
      message: 'Appointment successfully booked and confirmed!',
      reference,
      appointment: {
        id: appointmentId,
        reference,
        doctorName: doc.name,
        specialization: doc.specialization,
        date: appointmentDate,
        time: scheduledTime,
        branch: schedule.hospital_branch,
        status: 'APPOINTED'
      }
    });
  } catch (err) {
    await conn.rollback();
    console.error('Booking error:', err);
    res.status(500).json({ error: err.message || 'Server error while processing booking.' });
  } finally {
    conn.release();
  }
});

// 5. Public Doctor Availability: This Week & Upcoming Week
app.get('/api/public/doctor-schedules', async (req, res) => {
  try {
    const { week = 'this_week', departmentId, doctorId } = req.query;
    const today = new Date();
    // Monday of this week
    const day = today.getDay();
    const diffToMon = today.getDate() - day + (day === 0 ? -6 : 1);
    const mondayThisWeek = new Date(today.setDate(diffToMon));
    mondayThisWeek.setHours(0, 0, 0, 0);

    let startDate, endDate;
    if (week === 'next_week') {
      const mondayNextWeek = new Date(mondayThisWeek);
      mondayNextWeek.setDate(mondayThisWeek.getDate() + 7);
      startDate = mondayNextWeek.toISOString().split('T')[0];
      const sundayNextWeek = new Date(mondayNextWeek);
      sundayNextWeek.setDate(sundayNextWeek.getDate() + 6);
      endDate = sundayNextWeek.toISOString().split('T')[0];
    } else {
      startDate = mondayThisWeek.toISOString().split('T')[0];
      const sundayThisWeek = new Date(mondayThisWeek);
      sundayThisWeek.setDate(sundayThisWeek.getDate() + 6);
      endDate = sundayThisWeek.toISOString().split('T')[0];
    }

    let sql = `
      SELECT ds.*, d.name as doctor_name, d.specialization, d.profile_image,
             dept.id as department_id, dept.name as department_name,
             r.room_number, r.name as room_name,
             (SELECT COUNT(*) FROM appointments a 
              WHERE a.doctor_id = ds.doctor_id 
                AND a.appointment_date = ds.schedule_date 
                AND a.status NOT IN ('CANCELLED', 'MISSED')) as booked_count
      FROM doctor_schedules ds
      JOIN doctors d ON ds.doctor_id = d.id
      JOIN departments dept ON d.department_id = dept.id
      LEFT JOIN rooms r ON ds.room_id = r.id
      WHERE ds.schedule_date BETWEEN ? AND ?
        AND ds.is_published = 1
    `;
    const params = [startDate, endDate];
    if (departmentId) {
      sql += ' AND d.department_id = ?';
      params.push(departmentId);
    }
    if (doctorId) {
      sql += ' AND ds.doctor_id = ?';
      params.push(doctorId);
    }
    sql += ' ORDER BY ds.schedule_date ASC, ds.start_time ASC';

    const schedules = await query(sql, params);

    const formatted = schedules.map(s => ({
      id: s.id,
      doctorId: s.doctor_id,
      doctorName: s.doctor_name,
      specialization: s.specialization,
      departmentId: s.department_id,
      departmentName: s.department_name,
      profileImage: s.profile_image,
      date: s.schedule_date instanceof Date ? s.schedule_date.toISOString().split('T')[0] : String(s.schedule_date),
      startTime: s.start_time,
      endTime: s.end_time,
      breakStart: s.break_start,
      breakEnd: s.break_end,
      hospitalBranch: s.hospital_branch,
      roomNumber: s.room_number || 'Room TBD',
      duration: s.appointment_duration,
      status: s.status,
      bookingDisabled: !!s.booking_disabled,
      bookedCount: s.booked_count || 0,
      maxCapacity: s.max_capacity,
      hasSlots: s.status === 'AVAILABLE' && !s.booking_disabled && (s.booked_count || 0) < s.max_capacity
    }));

    res.json({
      success: true,
      week,
      startDate,
      endDate,
      schedules: formatted
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Admin Panel: Doctor Schedules Management (Full CRUD + Conflict Protection)
app.get('/api/admin/schedules', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { startDate, endDate, doctorId } = req.query;
    let sql = `
      SELECT ds.*, d.name as doctor_name, d.specialization,
             dept.name as department_name, r.room_number,
             (SELECT COUNT(*) FROM appointments a 
              WHERE a.doctor_id = ds.doctor_id 
                AND a.appointment_date = ds.schedule_date 
                AND a.status NOT IN ('CANCELLED', 'MISSED')) as booked_count
      FROM doctor_schedules ds
      JOIN doctors d ON ds.doctor_id = d.id
      JOIN departments dept ON d.department_id = dept.id
      LEFT JOIN rooms r ON ds.room_id = r.id
      WHERE 1=1
    `;
    const params = [];
    if (startDate && endDate) {
      sql += ' AND ds.schedule_date BETWEEN ? AND ?';
      params.push(startDate, endDate);
    }
    if (doctorId) {
      sql += ' AND ds.doctor_id = ?';
      params.push(doctorId);
    }
    sql += ' ORDER BY ds.schedule_date ASC, ds.start_time ASC';

    const schedules = await query(sql, params);
    res.json({ success: true, schedules });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Save or Update Schedule with Room Conflict & Appointment Conflict Check
app.post('/api/admin/schedules/save', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const {
      id,
      doctorId,
      scheduleDate,
      startTime,
      endTime,
      breakStart,
      breakEnd,
      hospitalBranch = 'Main Pavilion - Colombo',
      roomId,
      appointmentDuration = 15,
      maxCapacity = 30,
      status = 'AVAILABLE',
      isPublished = 1,
      bookingDisabled = 0,
      forceResolution = false
    } = req.body;

    if (!doctorId || !scheduleDate || !startTime || !endTime) {
      return res.status(400).json({ error: 'Doctor, schedule date, start time, and end time are required.' });
    }

    // Conflict Check 1: Overlapping Room Assignment with another doctor on the same date/time
    if (roomId) {
      const roomConflicts = await query(`
        SELECT ds.*, d.name as doctor_name FROM doctor_schedules ds
        JOIN doctors d ON ds.doctor_id = d.id
        WHERE ds.room_id = ? 
          AND ds.schedule_date = ? 
          AND ds.doctor_id != ?
          AND (
            (ds.start_time < ? AND ds.end_time > ?) OR
            (ds.start_time < ? AND ds.end_time > ?) OR
            (ds.start_time >= ? AND ds.end_time <= ?)
          )
      `, [roomId, scheduleDate, doctorId, endTime, startTime, startTime, startTime, startTime, endTime]);

      if (roomConflicts.length > 0) {
        return res.status(409).json({
          conflictType: 'ROOM_CONFLICT',
          error: `Room conflict: ${roomConflicts[0].doctor_name} is already assigned to this room during this time frame (${roomConflicts[0].start_time} - ${roomConflicts[0].end_time}).`
        });
      }
    }

    // Conflict Check 2: Existing appointments that fall outside the proposed new schedule or if setting to ON_LEAVE/UNAVAILABLE
    if (id || doctorId) {
      const existingAppts = await query(`
        SELECT a.*, p.name as patient_name FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        WHERE a.doctor_id = ? 
          AND a.appointment_date = ? 
          AND a.status NOT IN ('CANCELLED', 'MISSED')
      `, [doctorId, scheduleDate]);

      if (existingAppts.length > 0) {
        if (status === 'ON_LEAVE' || status === 'UNAVAILABLE') {
          if (!forceResolution) {
            return res.status(409).json({
              conflictType: 'APPOINTMENTS_EXIST',
              error: `Warning: There are ${existingAppts.length} active patient booking(s) scheduled for this date. Changing status to ${status} requires explicit confirmation.`,
              existingCount: existingAppts.length,
              appointments: existingAppts
            });
          }
        }

        // Check if any booking falls outside new start or end time
        const outOfBounds = existingAppts.filter(a => a.scheduled_time < startTime || a.scheduled_time >= endTime);
        if (outOfBounds.length > 0 && !forceResolution) {
          return res.status(409).json({
            conflictType: 'APPOINTMENTS_OUT_OF_BOUNDS',
            error: `Warning: ${outOfBounds.length} booking(s) fall outside proposed working hours (${startTime} - ${endTime}). Please adjust schedule or resolve conflicting bookings.`,
            conflicts: outOfBounds
          });
        }
      }
    }

    const scheduleId = id || `sched-${doctorId}-${scheduleDate}`;

    await query(`
      INSERT INTO doctor_schedules (
        id, doctor_id, schedule_date, start_time, end_time, break_start, break_end,
        hospital_branch, room_id, appointment_duration, max_capacity, status,
        is_published, booking_disabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        start_time = VALUES(start_time),
        end_time = VALUES(end_time),
        break_start = VALUES(break_start),
        break_end = VALUES(break_end),
        hospital_branch = VALUES(hospital_branch),
        room_id = VALUES(room_id),
        appointment_duration = VALUES(appointment_duration),
        max_capacity = VALUES(max_capacity),
        status = VALUES(status),
        is_published = VALUES(is_published),
        booking_disabled = VALUES(booking_disabled)
    `, [
      scheduleId, doctorId, scheduleDate, startTime, endTime, breakStart || null, breakEnd || null,
      hospitalBranch, roomId || null, appointmentDuration, maxCapacity, status,
      isPublished ? 1 : 0, bookingDisabled ? 1 : 0
    ]);

    await query(`
      INSERT INTO audit_logs (id, actor_id, actor_role, action, target_type, target_id, details)
      VALUES (?, ?, 'admin', 'UPDATE_SCHEDULE', 'doctor_schedule', ?, ?)
    `, [uuidv4(), req.user.id, scheduleId, `Admin updated schedule for doctor ${doctorId} on ${scheduleDate} (${status})`]);

    // Broadcast schedule update so public pages & doctor calendar reload in real-time
    io.emit('schedule.updated', { doctorId, scheduleDate });

    res.json({
      success: true,
      message: 'Doctor schedule successfully saved and published!',
      scheduleId
    });
  } catch (err) {
    console.error('Error saving schedule:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: Copy Weekly Schedule to Next Week
app.post('/api/admin/schedules/copy-week', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { fromWeekStart, toWeekStart, doctorId } = req.body;
    if (!fromWeekStart || !toWeekStart) {
      return res.status(400).json({ error: 'Source week start date and target week start date are required.' });
    }

    // Calculate 7-day range for source week
    const srcStart = new Date(fromWeekStart);
    const srcEnd = new Date(srcStart);
    srcEnd.setDate(srcEnd.getDate() + 6);

    const srcStartDateStr = srcStart.toISOString().split('T')[0];
    const srcEndDateStr = srcEnd.toISOString().split('T')[0];

    let sql = 'SELECT * FROM doctor_schedules WHERE schedule_date BETWEEN ? AND ?';
    const params = [srcStartDateStr, srcEndDateStr];
    if (doctorId) {
      sql += ' AND doctor_id = ?';
      params.push(doctorId);
    }

    const sourceSchedules = await query(sql, params);
    if (sourceSchedules.length === 0) {
      return res.status(404).json({ error: 'No schedules found in the selected source week to copy.' });
    }

    const dayDiff = Math.round((new Date(toWeekStart) - new Date(fromWeekStart)) / (1000 * 60 * 60 * 24));
    let copiedCount = 0;

    for (const s of sourceSchedules) {
      const origDate = new Date(s.schedule_date);
      origDate.setDate(origDate.getDate() + dayDiff);
      const newDateStr = origDate.toISOString().split('T')[0];
      const newId = `sched-${s.doctor_id}-${newDateStr}`;

      await query(`
        INSERT INTO doctor_schedules (
          id, doctor_id, schedule_date, start_time, end_time, break_start, break_end,
          hospital_branch, room_id, appointment_duration, max_capacity, status,
          is_published, booking_disabled
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          start_time = VALUES(start_time),
          end_time = VALUES(end_time),
          break_start = VALUES(break_start),
          break_end = VALUES(break_end),
          hospital_branch = VALUES(hospital_branch),
          room_id = VALUES(room_id),
          appointment_duration = VALUES(appointment_duration),
          max_capacity = VALUES(max_capacity),
          status = VALUES(status),
          is_published = VALUES(is_published),
          booking_disabled = VALUES(booking_disabled)
      `, [
        newId, s.doctor_id, newDateStr, s.start_time, s.end_time, s.break_start, s.break_end,
        s.hospital_branch, s.room_id, s.appointment_duration, s.max_capacity, s.status,
        s.is_published, s.booking_disabled
      ]);
      copiedCount++;
    }

    io.emit('schedule.updated', { toWeekStart });
    res.json({ success: true, message: `Successfully copied ${copiedCount} doctor schedule slots to target week!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Delete Schedule
app.delete('/api/admin/schedules/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const schedId = req.params.id;
    const [sched] = await query('SELECT * FROM doctor_schedules WHERE id = ?', [schedId]);
    if (!sched) return res.status(404).json({ error: 'Schedule not found.' });

    // Check existing appointments
    const existing = await query(`
      SELECT COUNT(*) as count FROM appointments 
      WHERE doctor_id = ? AND appointment_date = ? AND status NOT IN ('CANCELLED', 'MISSED')
    `, [sched.doctor_id, sched.schedule_date]);

    if (existing[0].count > 0 && !req.query.force) {
      return res.status(409).json({
        error: `Cannot delete schedule: ${existing[0].count} patient appointment(s) exist on this date. Please reassign or cancel them first.`
      });
    }

    await query('DELETE FROM doctor_schedules WHERE id = ?', [schedId]);
    io.emit('schedule.updated', { doctorId: sched.doctor_id });

    res.json({ success: true, message: 'Doctor schedule deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Doctor Personal Dashboard: Summary Stats & Appointments with Strict Doctor Access Guard
app.get('/api/doctor/my-dashboard', requireAuth, requireRole('doctor', 'admin'), async (req, res) => {
  try {
    const doctorId = req.user.role === 'doctor' ? req.user.doctorId : (req.query.doctorId || 'doc-1');
    if (!doctorId) {
      return res.status(400).json({ error: 'No doctor associated with this user.' });
    }

    const [doctor] = await query(`
      SELECT d.*, r.room_number, r.name as room_name, dept.name as department_name
      FROM doctors d
      LEFT JOIN rooms r ON d.current_room_id = r.id
      JOIN departments dept ON d.department_id = dept.id
      WHERE d.id = ?
    `, [doctorId]);

    if (!doctor) return res.status(404).json({ error: 'Doctor not found.' });

    const todayStr = new Date().toISOString().split('T')[0];

    // Summary Cards (today, upcoming, waiting, completed, next scheduled)
    const [statsRow] = await query(`
      SELECT 
        (SELECT COUNT(*) FROM appointments WHERE doctor_id = ? AND appointment_date = CURDATE() AND status NOT IN ('CANCELLED')) as today_appts,
        (SELECT COUNT(*) FROM appointments WHERE doctor_id = ? AND appointment_date > CURDATE() AND status NOT IN ('CANCELLED')) as upcoming_appts,
        (SELECT COUNT(*) FROM appointments WHERE doctor_id = ? AND status = 'COMPLETED') as completed_appts,
        (SELECT COUNT(*) FROM appointments WHERE doctor_id = ? AND status = 'CANCELLED') as cancelled_appts,
        (SELECT COUNT(*) FROM queue_tokens qt 
         JOIN clinic_sessions cs ON qt.session_id = cs.id
         JOIN clinics c ON cs.clinic_id = c.id
         WHERE c.department_id = ? AND qt.status = 'WAITING') as waiting_patients
    `, [doctorId, doctorId, doctorId, doctorId, doctor.department_id]);

    // Next scheduled appointment
    const nextAppts = await query(`
      SELECT a.*, p.name as patient_name, p.phone as patient_phone, r.room_number
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      LEFT JOIN doctor_schedules ds ON a.doctor_schedule_id = ds.id
      LEFT JOIN rooms r ON ds.room_id = r.id
      WHERE a.doctor_id = ? 
        AND (a.appointment_date > CURDATE() OR (a.appointment_date = CURDATE() AND a.scheduled_time >= TIME(NOW())))
        AND a.status = 'APPOINTED'
      ORDER BY a.appointment_date ASC, a.scheduled_time ASC
      LIMIT 1
    `, [doctorId]);

    // All Appointments assigned strictly to this doctor
    const appointments = await query(`
      SELECT a.*, p.name as patient_name, p.phone as patient_phone, p.gender, p.blood_group,
             r.room_number, ds.hospital_branch, qt.token_number as active_token_number
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      LEFT JOIN doctor_schedules ds ON a.doctor_schedule_id = ds.id
      LEFT JOIN rooms r ON COALESCE(ds.room_id, ?) = r.id
      LEFT JOIN queue_tokens qt ON (qt.patient_id = a.patient_id AND qt.status IN ('WAITING', 'CALLED', 'ARRIVED', 'IN_CONSULTATION'))
      WHERE a.doctor_id = ?
      ORDER BY a.appointment_date DESC, a.scheduled_time ASC
    `, [doctor.current_room_id || doctor.default_room_id, doctorId]);

    // Doctor Working Schedule for the Calendar
    const schedules = await query(`
      SELECT ds.*, r.room_number
      FROM doctor_schedules ds
      LEFT JOIN rooms r ON ds.room_id = r.id
      WHERE ds.doctor_id = ? AND ds.schedule_date >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
      ORDER BY ds.schedule_date ASC
    `, [doctorId]);

    res.json({
      success: true,
      doctor,
      stats: {
        todayAppts: statsRow.today_appts || 0,
        upcomingAppts: statsRow.upcoming_appts || 0,
        waitingPatients: statsRow.waiting_patients || 0,
        completedAppts: statsRow.completed_appts || 0,
        cancelledAppts: statsRow.cancelled_appts || 0,
        nextAppt: nextAppts.length > 0 ? nextAppts[0] : null
      },
      appointments,
      schedules
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public Live Queue Display Panel (Doctors, Current Token, Next Token, Status, Wait Time)
app.get('/api/public/live-queue', async (req, res) => {
  try {
    const list = await queueManager.getPublicLiveQueue();
    res.json({
      success: true,
      data: list,
      serverTime: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Display, sessions, doctors, rooms lists
app.get('/api/displays/:code', async (req, res) => {
  try {
    const data = await queueManager.getDisplaySnapshot(req.params.code.toUpperCase());
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sessions', async (req, res) => {
  try {
    const sessions = await query(`
      SELECT cs.*, c.name as clinic_name, c.code as clinic_code, d.name as department_name,
             (SELECT COUNT(*) FROM queue_tokens qt WHERE qt.session_id = cs.id AND qt.status = 'WAITING') as waiting_count,
             (SELECT COUNT(*) FROM queue_tokens qt WHERE qt.session_id = cs.id AND qt.status IN ('CALLED', 'IN_CONSULTATION')) as active_count
      FROM clinic_sessions cs
      JOIN clinics c ON cs.clinic_id = c.id
      JOIN departments d ON c.department_id = d.id
      WHERE cs.state = 'ACTIVE'
    `);
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/doctors', async (req, res) => {
  try {
    const doctors = await query(`
      SELECT d.*, r.room_number, r.name as room_name, dept.name as department_name,
             (SELECT qt.token_number FROM queue_tokens qt 
              WHERE qt.doctor_id = d.id AND qt.status IN ('CALLED', 'IN_CONSULTATION') 
              ORDER BY qt.called_at DESC LIMIT 1) as current_token
      FROM doctors d
      LEFT JOIN rooms r ON d.current_room_id = r.id
      JOIN departments dept ON d.department_id = dept.id
      ORDER BY d.id ASC
    `);
    res.json(doctors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/patients', async (req, res) => {
  try {
    const patients = await query(`
      SELECT p.*, pb.barcode_value,
             (SELECT COUNT(*) FROM consultations c WHERE c.patient_id = p.id) as past_visits_count
      FROM patients p
      LEFT JOIN patient_barcodes pb ON p.id = pb.patient_id
      ORDER BY p.hospital_number ASC
    `);
    res.json(patients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/rooms', async (req, res) => {
  try {
    const rooms = await query('SELECT r.*, d.name as department_name FROM rooms r JOIN departments d ON r.department_id = d.id');
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

io.on('connection', (socket) => {
  socket.on('subscribe.display', (code) => socket.join(`display-${code}`));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`HOSPITAL QUEUE MANAGEMENT SYSTEM running on port ${PORT}`);
  console.log(`Connected to MySQL: ${process.env.DB_NAME || 'hospital_queue_db'}`);
  console.log(`=======================================================`);
});
