const { query, getConnection } = require('./db');
const { v4: uuidv4 } = require('uuid');

class QueueManager {
  /**
   * Resolve patient by scanned barcode or hospital patient ID
   */
  async lookupPatientByBarcode(barcodeOrId) {
    const trimmed = (barcodeOrId || '').trim();
    const sql = `
      SELECT p.*, pb.barcode_value,
             (SELECT a.reference FROM appointments a 
              WHERE a.patient_id = p.id 
                AND a.status = 'APPOINTED' 
                AND a.session_id IN (SELECT id FROM clinic_sessions WHERE state = 'ACTIVE')
              LIMIT 1) as active_booking_ref,
             (SELECT a.session_id FROM appointments a 
              WHERE a.patient_id = p.id 
                AND a.status = 'APPOINTED' 
                AND a.session_id IN (SELECT id FROM clinic_sessions WHERE state = 'ACTIVE')
              LIMIT 1) as active_booking_session_id
      FROM patients p
      LEFT JOIN patient_barcodes pb ON p.id = pb.patient_id
      WHERE pb.barcode_value = ? OR p.hospital_number = ? OR p.id = ?
      LIMIT 1
    `;
    const patients = await query(sql, [trimmed, trimmed, trimmed]);
    if (!patients || patients.length === 0) return null;
    const patient = patients[0];

    // Check if patient already has an active waiting or called token today
    const activeTokens = await query(`
      SELECT qt.*, cs.session_code, cs.session_name, r.room_number, d.name as doctor_name
      FROM queue_tokens qt
      JOIN clinic_sessions cs ON qt.session_id = cs.id
      LEFT JOIN rooms r ON qt.room_id = r.id
      LEFT JOIN doctors d ON qt.doctor_id = d.id
      WHERE qt.patient_id = ? AND qt.status IN ('WAITING', 'ASSIGNED', 'CALLED', 'ARRIVED', 'IN_CONSULTATION', 'RECALLED', 'AWAITING_PATIENT')
      ORDER BY qt.issued_at DESC
      LIMIT 1
    `, [patient.id]);

    return {
      patient,
      activeToken: activeTokens.length > 0 ? activeTokens[0] : null,
      booking: patient.active_booking_ref ? {
        reference: patient.active_booking_ref,
        sessionId: patient.active_booking_session_id
      } : null
    };
  }

  /**
   * Check in patient and issue token atomically with MySQL transactions
   */
  async issueToken({ patientId, sessionId, priority = 1, isAppointment = false, appointmentRef = null, actorId = 'receptionist1' }) {
    const conn = await getConnection();
    await conn.beginTransaction();

    try {
      const [sessions] = await conn.execute('SELECT * FROM clinic_sessions WHERE id = ? FOR UPDATE', [sessionId]);
      if (sessions.length === 0) throw new Error('Selected clinic session does not exist.');
      const session = sessions[0];
      if (session.state !== 'ACTIVE') throw new Error('Clinic session is currently not active.');

      const [existingActive] = await conn.execute(`
        SELECT * FROM queue_tokens 
        WHERE patient_id = ? AND session_id = ? AND status IN ('WAITING', 'ASSIGNED', 'CALLED', 'ARRIVED', 'IN_CONSULTATION', 'RECALLED', 'AWAITING_PATIENT')
        FOR UPDATE
      `, [patientId, sessionId]);

      if (existingActive.length > 0) {
        await conn.commit();
        const active = existingActive[0];
        const eta = await this.calculateETA(sessionId, active.id);
        return {
          reused: true,
          token: active,
          eta,
          message: `Patient already has an active queue token: ${active.token_number}`
        };
      }

      let appointmentId = null;
      if (appointmentRef) {
        const [appts] = await conn.execute('SELECT id, status FROM appointments WHERE reference = ?', [appointmentRef]);
        if (appts.length > 0) {
          appointmentId = appts[0].id;
          await conn.execute("UPDATE appointments SET status = 'CHECKED_IN' WHERE id = ?", [appointmentId]);
        }
      } else {
        const [autoAppts] = await conn.execute(`
          SELECT id FROM appointments 
          WHERE patient_id = ? AND session_id = ? AND status = 'APPOINTED'
          LIMIT 1
        `, [patientId, sessionId]);
        if (autoAppts.length > 0) {
          appointmentId = autoAppts[0].id;
          await conn.execute("UPDATE appointments SET status = 'CHECKED_IN' WHERE id = ?", [appointmentId]);
        }
      }

      const visitId = uuidv4();
      const [visitCount] = await conn.execute('SELECT COUNT(*) as count FROM visits');
      const visitSeq = (visitCount[0].count || 0) + 1;
      const visitRef = `VIS-${String(visitSeq).padStart(4, '0')}`;

      await conn.execute(`
        INSERT INTO visits (id, visit_reference, patient_id, appointment_id, session_id, arrival_time)
        VALUES (?, ?, ?, ?, ?, NOW())
      `, [visitId, visitRef, patientId, appointmentId, sessionId]);

      const [seqRows] = await conn.execute(`
        SELECT COALESCE(MAX(token_seq), 0) as maxSeq 
        FROM queue_tokens 
        WHERE session_id = ?
        FOR UPDATE
      `, [sessionId]);

      const nextSeq = (seqRows[0].maxSeq || 0) + 1;
      const tokenNumber = `${session.session_code}-${String(nextSeq).padStart(3, '0')}`;
      const tokenId = uuidv4();

      await conn.execute(`
        INSERT INTO queue_tokens (
          id, token_number, token_seq, session_id, visit_id, patient_id, 
          priority, status, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'WAITING', NOW())
      `, [tokenId, tokenNumber, nextSeq, sessionId, visitId, patientId, priority]);

      await conn.execute(`
        INSERT INTO queue_events (id, token_id, session_id, actor_id, action, reason)
        VALUES (?, ?, ?, ?, 'ISSUED', ?)
      `, [uuidv4(), tokenId, sessionId, actorId, isAppointment ? 'Appointment Check-in' : 'Walk-in Check-in']);

      // Create notification for patient (Section 1.D)
      await conn.execute(`
        INSERT INTO notifications (id, patient_id, title, message, category, reference_id)
        VALUES (?, ?, 'Queue Token Issued', ?, 'QUEUE', ?)
      `, [uuidv4(), patientId, `Your queue token ${tokenNumber} has been issued for ${session.session_name}.`, tokenId]);

      await conn.commit();

      const [issuedRows] = await query(`
        SELECT qt.*, p.name as patient_name, p.hospital_number, cs.session_name, cs.session_code, v.visit_reference
        FROM queue_tokens qt
        JOIN patients p ON qt.patient_id = p.id
        JOIN clinic_sessions cs ON qt.session_id = cs.id
        JOIN visits v ON qt.visit_id = v.id
        WHERE qt.id = ?
      `, [tokenId]);

      const etaData = await this.calculateETA(sessionId, tokenId);

      return {
        reused: false,
        token: issuedRows[0],
        eta: etaData
      };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Safe Atomic Next Patient Selection (Multi-Doctor Concurrency with FOR UPDATE)
   */
  async callNextPatient(doctorId) {
    const conn = await getConnection();
    await conn.beginTransaction();

    try {
      const [doctors] = await conn.execute('SELECT * FROM doctors WHERE id = ? FOR UPDATE', [doctorId]);
      if (doctors.length === 0) throw new Error('Doctor profile not found.');
      const doctor = doctors[0];

      if (doctor.duty_status !== 'ON_DUTY') {
        throw new Error('Doctor is not on duty. Please toggle duty status to ON_DUTY.');
      }
      if (!doctor.current_room_id) {
        throw new Error('Doctor has no examination room currently assigned.');
      }

      // Check if doctor already has an active called, arrived, or in-consultation token
      const [currentPatient] = await conn.execute(`
        SELECT qt.*, p.name as patient_name, p.hospital_number, r.room_number 
        FROM queue_tokens qt
        JOIN patients p ON qt.patient_id = p.id
        JOIN rooms r ON qt.room_id = r.id
        WHERE qt.doctor_id = ? AND qt.status IN ('CALLED', 'ARRIVED', 'IN_CONSULTATION', 'RECALLED', 'AWAITING_PATIENT')
        ORDER BY qt.called_at DESC
        LIMIT 1
      `, [doctorId]);

      if (currentPatient.length > 0) {
        await conn.commit();
        return {
          hasActive: true,
          token: currentPatient[0],
          message: `You are currently attending token ${currentPatient[0].token_number}. Please complete or skip this consultation first.`
        };
      }

      const [sessions] = await conn.execute(`
        SELECT cs.id, cs.session_code, cs.session_name
        FROM clinic_sessions cs
        JOIN clinics c ON cs.clinic_id = c.id
        WHERE c.department_id = ? AND cs.state = 'ACTIVE'
        ORDER BY cs.session_date DESC
        LIMIT 1
      `, [doctor.department_id]);

      if (sessions.length === 0) {
        throw new Error('No active queue session found for your department.');
      }
      const targetSession = sessions[0];

      const [nextTokens] = await conn.execute(`
        SELECT qt.*, p.name as patient_name, p.hospital_number
        FROM queue_tokens qt
        JOIN patients p ON qt.patient_id = p.id
        WHERE qt.session_id = ? AND qt.status = 'WAITING'
        ORDER BY qt.priority DESC, qt.token_seq ASC
        LIMIT 1
        FOR UPDATE
      `, [targetSession.id]);

      if (nextTokens.length === 0) {
        await conn.commit();
        return {
          empty: true,
          message: 'No patients currently waiting in queue.'
        };
      }

      const nextToken = nextTokens[0];

      await conn.execute(`
        UPDATE queue_tokens 
        SET status = 'CALLED',
            doctor_id = ?,
            room_id = ?,
            assigned_at = NOW(),
            called_at = NOW()
        WHERE id = ? AND status = 'WAITING'
      `, [doctorId, doctor.current_room_id, nextToken.id]);

      await conn.execute(`
        INSERT INTO queue_events (id, token_id, session_id, actor_id, action, reason)
        VALUES (?, ?, ?, ?, 'CALLED', ?)
      `, [uuidv4(), nextToken.id, targetSession.id, doctorId, `Called to ${doctor.current_room_id}`]);

      // Patient Notification on Room Call
      await conn.execute(`
        INSERT INTO notifications (id, patient_id, title, message, category, reference_id)
        VALUES (?, ?, 'Room Call Announcement', ?, 'QUEUE', ?)
      `, [uuidv4(), nextToken.patient_id, `Your token ${nextToken.token_number} has been called to ${doctor.current_room_id}. Please enter now.`, nextToken.id]);

      await conn.commit();

      const [assignedToken] = await query(`
        SELECT qt.*, p.name as patient_name, p.hospital_number, r.room_number, d.name as doctor_name
        FROM queue_tokens qt
        JOIN patients p ON qt.patient_id = p.id
        JOIN rooms r ON qt.room_id = r.id
        JOIN doctors d ON qt.doctor_id = d.id
        WHERE qt.id = ?
      `, [nextToken.id]);

      return {
        success: true,
        token: assignedToken[0]
      };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Mark Patient as Arrived at Doctor Examination Room
   */
  async markPatientArrived(tokenId, doctorId) {
    const tokens = await query('SELECT * FROM queue_tokens WHERE id = ?', [tokenId]);
    if (tokens.length === 0) throw new Error('Token not found');
    const token = tokens[0];

    const allowed = ['CALLED', 'RECALLED', 'AWAITING_PATIENT', 'WAITING'];
    if (!allowed.includes(token.status)) {
      throw new Error(`Cannot mark arrived from current status: ${token.status}`);
    }

    await query(`
      UPDATE queue_tokens 
      SET status = 'ARRIVED', arrived_at = NOW() 
      WHERE id = ?
    `, [tokenId]);

    await query(`
      INSERT INTO queue_events (id, token_id, session_id, actor_id, action, reason)
      VALUES (?, ?, ?, ?, 'ARRIVED', 'Patient arrived at consultation room')
    `, [uuidv4(), tokenId, token.session_id, doctorId]);

    const updated = await query(`
      SELECT qt.*, p.name as patient_name, r.room_number, d.name as doctor_name
      FROM queue_tokens qt
      JOIN patients p ON qt.patient_id = p.id
      LEFT JOIN rooms r ON qt.room_id = r.id
      LEFT JOIN doctors d ON qt.doctor_id = d.id
      WHERE qt.id = ?
    `, [tokenId]);

    return updated[0];
  }

  /**
   * Start Clinical Consultation
   */
  async startConsultation(tokenId, doctorId) {
    const tokens = await query('SELECT * FROM queue_tokens WHERE id = ?', [tokenId]);
    if (tokens.length === 0) throw new Error('Token not found');
    const token = tokens[0];

    const allowed = ['CALLED', 'ARRIVED', 'RECALLED', 'AWAITING_PATIENT'];
    if (!allowed.includes(token.status)) {
      throw new Error(`Cannot start consultation from status: ${token.status}`);
    }

    await query(`
      UPDATE queue_tokens 
      SET status = 'IN_CONSULTATION', consultation_started_at = NOW() 
      WHERE id = ?
    `, [tokenId]);

    await query(`
      INSERT INTO queue_events (id, token_id, session_id, actor_id, action)
      VALUES (?, ?, ?, ?, 'IN_CONSULTATION')
    `, [uuidv4(), tokenId, token.session_id, doctorId]);

    const updated = await query(`
      SELECT qt.*, p.name as patient_name, r.room_number, d.name as doctor_name
      FROM queue_tokens qt
      JOIN patients p ON qt.patient_id = p.id
      LEFT JOIN rooms r ON qt.room_id = r.id
      LEFT JOIN doctors d ON qt.doctor_id = d.id
      WHERE qt.id = ?
    `, [tokenId]);

    return updated[0];
  }

  /**
   * Complete Consultation & Save Clinical Record, Care Tasks, Recommendations, and Notifications
   */
  async completeConsultation({
    tokenId,
    doctorId,
    symptoms,
    diagnosis,
    clinicalNotes,
    recommendations,
    followUpAdvice,
    prescriptions = [],
    labs = [],
    tasks = []
  }) {
    const conn = await getConnection();
    await conn.beginTransaction();

    try {
      const [tokens] = await conn.execute('SELECT * FROM queue_tokens WHERE id = ? FOR UPDATE', [tokenId]);
      if (tokens.length === 0) throw new Error('Token not found');
      const token = tokens[0];

      if (token.status === 'COMPLETED') {
        await conn.commit();
        return { consultationId: null, message: 'Consultation already completed' };
      }

      // 1. Mark token COMPLETED
      await conn.execute("UPDATE queue_tokens SET status = 'COMPLETED', completed_at = NOW() WHERE id = ?", [tokenId]);

      // 2. Queue event
      await conn.execute(`
        INSERT INTO queue_events (id, token_id, session_id, actor_id, action)
        VALUES (?, ?, ?, ?, 'COMPLETED')
      `, [uuidv4(), tokenId, token.session_id, doctorId]);

      // 3. Consultation record
      const consultId = uuidv4();
      await conn.execute(`
        INSERT INTO consultations (
          id, visit_id, patient_id, doctor_id, symptoms, diagnosis, 
          clinical_notes, recommendations, follow_up_advice, started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `, [
        consultId, token.visit_id, token.patient_id, doctorId,
        symptoms || '', diagnosis || '', clinicalNotes || '',
        recommendations || '', followUpAdvice || '',
        token.consultation_started_at || token.called_at || new Date()
      ]);

      // 4. Prescriptions
      for (const p of prescriptions) {
        if (p.itemName) {
          await conn.execute(`
            INSERT INTO prescriptions (id, consultation_id, item_name, dosage, frequency, duration, instructions)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `, [uuidv4(), consultId, p.itemName, p.dosage || '1 tab', p.frequency || 'TDS', p.duration || '3 days', p.instructions || '']);
        }
      }

      // 5. Lab requests & Automatic Care Tasks
      for (const lab of labs) {
        if (lab.testName) {
          const labReqId = uuidv4();
          await conn.execute(`
            INSERT INTO lab_requests (id, consultation_id, patient_id, doctor_id, test_name, urgency, status)
            VALUES (?, ?, ?, ?, ?, ?, 'REQUESTED')
          `, [labReqId, consultId, token.patient_id, doctorId, lab.testName, lab.urgency || 'ROUTINE']);

          await conn.execute(`
            INSERT INTO care_tasks (id, patient_id, doctor_id, consultation_id, lab_request_id, title, description, task_type, due_date, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'LAB_TEST', DATE_ADD(CURDATE(), INTERVAL 2 DAY), 'PENDING')
          `, [
            uuidv4(), token.patient_id, doctorId, consultId, labReqId,
            `Complete ${lab.testName}`,
            `Please attend the diagnostic laboratory for ${lab.testName} (${lab.urgency || 'ROUTINE'}).`,
          ]);

          await conn.execute(`
            INSERT INTO notifications (id, patient_id, title, message, category, reference_id)
            VALUES (?, ?, 'New Lab Request', ?, 'CARE_TASK', ?)
          `, [uuidv4(), token.patient_id, `A new laboratory investigation (${lab.testName}) was requested by your doctor.`, labReqId]);
        }
      }

      // 6. Custom Follow-up Tasks (if any)
      for (const t of tasks) {
        if (t.title) {
          await conn.execute(`
            INSERT INTO care_tasks (id, patient_id, doctor_id, consultation_id, title, description, task_type, due_date, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
          `, [
            uuidv4(), token.patient_id, doctorId, consultId,
            t.title, t.description || '', t.taskType || 'OTHER', t.dueDate || null
          ]);
        }
      }

      // 7. General follow-up notification if advice was provided
      if (followUpAdvice) {
        await conn.execute(`
          INSERT INTO notifications (id, patient_id, title, message, category, reference_id)
          VALUES (?, ?, 'Doctor Consultation Summary', 'Your consultation notes and instructions are ready to view in your patient portal.', 'RECOMMENDATION', ?)
        `, [uuidv4(), token.patient_id, consultId]);
      }

      // 8. Audit log
      await conn.execute(`
        INSERT INTO audit_logs (id, actor_id, actor_role, action, target_type, target_id, details)
        VALUES (?, ?, 'doctor', 'COMPLETE_CONSULTATION', 'patient', ?, ?)
      `, [uuidv4(), doctorId, token.patient_id, `Consultation recorded: ${diagnosis || 'General OPD'}`]);

      await conn.commit();
      return { consultationId: consultId };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Skip Patient (Mark as SKIPPED without deleting history)
   */
  async skipPatient(tokenId, doctorId, reason = 'Patient absent / did not show up') {
    const tokens = await query('SELECT * FROM queue_tokens WHERE id = ?', [tokenId]);
    if (tokens.length === 0) throw new Error('Token not found');
    const token = tokens[0];

    await query("UPDATE queue_tokens SET status = 'SKIPPED' WHERE id = ?", [tokenId]);
    await query(`
      INSERT INTO queue_events (id, token_id, session_id, actor_id, action, reason)
      VALUES (?, ?, ?, ?, 'SKIPPED', ?)
    `, [uuidv4(), tokenId, token.session_id, doctorId, reason]);

    return { success: true, tokenId, tokenNumber: token.token_number };
  }

  /**
   * Recall a Skipped or Awaiting Patient back into queue
   */
  async recallSkippedPatient(tokenId, doctorId) {
    const tokens = await query('SELECT * FROM queue_tokens WHERE id = ?', [tokenId]);
    if (tokens.length === 0) throw new Error('Token not found');
    const token = tokens[0];

    const [doctors] = await query('SELECT current_room_id FROM doctors WHERE id = ?', [doctorId]);
    const roomId = doctors.length > 0 && doctors[0].current_room_id ? doctors[0].current_room_id : token.room_id;

    await query(`
      UPDATE queue_tokens 
      SET status = 'RECALLED', 
          called_at = NOW(), 
          doctor_id = ?, 
          room_id = ?
      WHERE id = ?
    `, [doctorId, roomId, tokenId]);

    await query(`
      INSERT INTO queue_events (id, token_id, session_id, actor_id, action, reason)
      VALUES (?, ?, ?, ?, 'RECALLED', 'Patient recalled to consultation room')
    `, [uuidv4(), tokenId, token.session_id, doctorId]);

    const updated = await query(`
      SELECT qt.*, p.name as patient_name, r.room_number, d.name as doctor_name
      FROM queue_tokens qt
      JOIN patients p ON qt.patient_id = p.id
      LEFT JOIN rooms r ON qt.room_id = r.id
      LEFT JOIN doctors d ON qt.doctor_id = d.id
      WHERE qt.id = ?
    `, [tokenId]);

    return updated[0];
  }

  /**
   * Recall Patient Chime (Standard Chime while CALLED)
   */
  async recallPatient(tokenId, doctorId) {
    const tokens = await query('SELECT * FROM queue_tokens WHERE id = ?', [tokenId]);
    if (tokens.length === 0) throw new Error('Token not found');
    const token = tokens[0];

    await query("UPDATE queue_tokens SET status = 'RECALLED', called_at = NOW() WHERE id = ?", [tokenId]);
    await query(`
      INSERT INTO queue_events (id, token_id, session_id, actor_id, action, reason)
      VALUES (?, ?, ?, ?, 'RECALLED', 'Chimed again on public display')
    `, [uuidv4(), tokenId, token.session_id, doctorId]);

    const updated = await query(`
      SELECT qt.*, p.name as patient_name, r.room_number, d.name as doctor_name
      FROM queue_tokens qt
      JOIN patients p ON qt.patient_id = p.id
      LEFT JOIN rooms r ON qt.room_id = r.id
      LEFT JOIN doctors d ON qt.doctor_id = d.id
      WHERE qt.id = ?
    `, [tokenId]);

    return updated[0];
  }

  /**
   * Mark Missed Token (Legacy)
   */
  async markMissed(tokenId, doctorId, reason = 'Patient absent at call time') {
    const tokens = await query('SELECT * FROM queue_tokens WHERE id = ?', [tokenId]);
    if (tokens.length === 0) throw new Error('Token not found');
    const token = tokens[0];

    await query("UPDATE queue_tokens SET status = 'SKIPPED' WHERE id = ?", [tokenId]);
    await query(`
      INSERT INTO queue_events (id, token_id, session_id, actor_id, action, reason)
      VALUES (?, ?, ?, ?, 'SKIPPED', ?)
    `, [uuidv4(), tokenId, token.session_id, doctorId, reason]);
  }

  /**
   * Mark Awaiting Patient when 60s countdown expires
   */
  async markAwaitingPatient(tokenId, doctorId) {
    const tokens = await query('SELECT * FROM queue_tokens WHERE id = ?', [tokenId]);
    if (tokens.length === 0) throw new Error('Token not found');
    const token = tokens[0];

    // Only update if still in CALLED or RECALLED state
    if (['CALLED', 'RECALLED'].includes(token.status)) {
      await query("UPDATE queue_tokens SET status = 'AWAITING_PATIENT' WHERE id = ?", [tokenId]);
      await query(`
        INSERT INTO queue_events (id, token_id, session_id, actor_id, action, reason)
        VALUES (?, ?, ?, ?, 'AWAITING_PATIENT', '60-second call countdown expired; awaiting arrival')
      `, [uuidv4(), tokenId, token.session_id, doctorId || 'system']);
    }

    const updated = await query(`
      SELECT qt.*, p.name as patient_name, r.room_number, d.name as doctor_name
      FROM queue_tokens qt
      JOIN patients p ON qt.patient_id = p.id
      LEFT JOIN rooms r ON qt.room_id = r.id
      LEFT JOIN doctors d ON qt.doctor_id = d.id
      WHERE qt.id = ?
    `, [tokenId]);

    return updated[0];
  }

  /**
   * Get Current State for Doctor Station
   */
  async getDoctorCurrentState(doctorId) {
    const doctors = await query(`
      SELECT d.*, r.room_number, r.name as room_name, dp.name as department_name
      FROM doctors d
      LEFT JOIN rooms r ON d.current_room_id = r.id
      LEFT JOIN departments dp ON d.department_id = dp.id
      WHERE d.id = ?
    `, [doctorId]);

    if (doctors.length === 0) return null;
    const doctor = doctors[0];

    const activeTokens = await query(`
      SELECT qt.*, p.name as patient_name, p.hospital_number, p.dob, p.gender, p.blood_group, p.allergies,
             r.room_number, cs.session_code, cs.session_name
      FROM queue_tokens qt
      JOIN patients p ON qt.patient_id = p.id
      LEFT JOIN rooms r ON qt.room_id = r.id
      JOIN clinic_sessions cs ON qt.session_id = cs.id
      WHERE qt.doctor_id = ? AND qt.status IN ('CALLED', 'ARRIVED', 'IN_CONSULTATION', 'RECALLED', 'AWAITING_PATIENT')
      ORDER BY qt.called_at DESC
      LIMIT 1
    `, [doctorId]);

    const activeToken = activeTokens.length > 0 ? activeTokens[0] : null;

    // Calculate remaining countdown seconds if in CALLED or RECALLED state
    let countdownRemaining = 0;
    if (activeToken && ['CALLED', 'RECALLED'].includes(activeToken.status) && activeToken.called_at) {
      const calledTime = new Date(activeToken.called_at).getTime();
      const elapsed = Math.floor((Date.now() - calledTime) / 1000);
      countdownRemaining = Math.max(0, 60 - elapsed);
    }

    // Next waiting tokens in the doctor's department session
    const sessions = await query(`
      SELECT cs.id FROM clinic_sessions cs
      JOIN clinics c ON cs.clinic_id = c.id
      WHERE c.department_id = ? AND cs.state = 'ACTIVE'
      ORDER BY cs.session_date DESC LIMIT 1
    `, [doctor.department_id]);

    let waitingTokens = [];
    let skippedTokens = [];
    let nextWaitingToken = null;

    if (sessions.length > 0) {
      const sessionId = sessions[0].id;

      waitingTokens = await query(`
        SELECT qt.id, qt.token_number, qt.token_seq, qt.priority, qt.status, qt.issued_at,
               p.hospital_number
        FROM queue_tokens qt
        JOIN patients p ON qt.patient_id = p.id
        WHERE qt.session_id = ? AND qt.status = 'WAITING'
        ORDER BY qt.priority DESC, qt.token_seq ASC
        LIMIT 10
      `, [sessionId]);

      if (waitingTokens.length > 0) {
        nextWaitingToken = waitingTokens[0].token_number;
      }

      skippedTokens = await query(`
        SELECT qt.id, qt.token_number, qt.token_seq, qt.priority, qt.status, qt.called_at,
               p.hospital_number, p.name as patient_name
        FROM queue_tokens qt
        JOIN patients p ON qt.patient_id = p.id
        WHERE qt.session_id = ? AND qt.status IN ('SKIPPED', 'MISSED')
        ORDER BY qt.called_at DESC
        LIMIT 10
      `, [sessionId]);
    }

    return {
      doctor,
      activeToken,
      countdownRemaining,
      serverTime: new Date().toISOString(),
      nextWaitingToken,
      waitingTokens,
      skippedTokens
    };
  }

  /**
   * Safe Public Live Queue Display Panel (Doctors & Tokens only - Zero Patient Info)
   */
  async getPublicLiveQueue() {
    const doctors = await query(`
      SELECT d.id, d.name, d.specialization, d.duty_status,
             r.room_number, r.name as room_name,
             dp.name as department_name, dp.id as department_id
      FROM doctors d
      LEFT JOIN rooms r ON d.current_room_id = r.id
      LEFT JOIN departments dp ON d.department_id = dp.id
      ORDER BY d.id ASC
    `);

    const result = [];

    for (const doc of doctors) {
      // Find active token currently assigned or attended by this doctor
      const activeRows = await query(`
        SELECT qt.id, qt.token_number, qt.status, qt.called_at, qt.consultation_started_at,
               qt.session_id
        FROM queue_tokens qt
        WHERE qt.doctor_id = ? AND qt.status IN ('CALLED', 'ARRIVED', 'IN_CONSULTATION', 'RECALLED', 'AWAITING_PATIENT')
        ORDER BY qt.called_at DESC
        LIMIT 1
      `, [doc.id]);

      const active = activeRows.length > 0 ? activeRows[0] : null;

      // Find department session
      const sessions = await query(`
        SELECT cs.id FROM clinic_sessions cs
        JOIN clinics c ON cs.clinic_id = c.id
        WHERE c.department_id = ? AND cs.state = 'ACTIVE'
        ORDER BY cs.session_date DESC LIMIT 1
      `, [doc.department_id]);

      let nextTokenNumber = null;
      let estimatedWaitText = 'Available';

      if (sessions.length > 0) {
        const sessionId = sessions[0].id;
        const nextRows = await query(`
          SELECT token_number FROM queue_tokens 
          WHERE session_id = ? AND status = 'WAITING'
          ORDER BY priority DESC, token_seq ASC 
          LIMIT 1
        `, [sessionId]);

        if (nextRows.length > 0) {
          nextTokenNumber = nextRows[0].token_number;
        }

        const eta = await this.calculateETA(sessionId);
        if (eta && eta.patientsAhead > 0) {
          estimatedWaitText = `~${eta.estimatedMinutes} mins (${eta.patientsAhead} waiting)`;
        } else if (active) {
          estimatedWaitText = 'In progress';
        } else {
          estimatedWaitText = 'Immediate / Next';
        }
      }

      // Map raw status to public friendly status
      let publicStatus = 'Waiting';
      let statusClass = 'status-waiting';
      let countdownRemaining = 0;

      if (doc.duty_status === 'OFF_DUTY') {
        publicStatus = 'Off Duty';
        statusClass = 'status-offduty';
      } else if (doc.duty_status === 'ON_BREAK') {
        publicStatus = 'Queue Paused';
        statusClass = 'status-paused';
      } else if (active) {
        if (active.status === 'CALLED' || active.status === 'RECALLED') {
          publicStatus = 'Calling Next Patient';
          statusClass = 'status-calling';
          if (active.called_at) {
            const calledTime = new Date(active.called_at).getTime();
            const elapsed = Math.floor((Date.now() - calledTime) / 1000);
            countdownRemaining = Math.max(0, 60 - elapsed);
          }
        } else if (active.status === 'ARRIVED') {
          publicStatus = 'Patient Arrived';
          statusClass = 'status-arrived';
        } else if (active.status === 'IN_CONSULTATION') {
          publicStatus = 'In Consultation';
          statusClass = 'status-consulting';
        } else if (active.status === 'AWAITING_PATIENT') {
          publicStatus = 'Awaiting Patient';
          statusClass = 'status-awaiting';
        }
      } else {
        publicStatus = 'Waiting';
        statusClass = 'status-waiting';
      }

      result.push({
        doctorId: doc.id,
        doctorName: doc.name,
        specialty: doc.specialization,
        roomNumber: doc.room_number || 'Room TBD',
        currentToken: active ? active.token_number : '—',
        nextToken: nextTokenNumber || '—',
        status: publicStatus,
        statusCode: active ? active.status : (doc.duty_status === 'ON_DUTY' ? 'WAITING' : doc.duty_status),
        statusClass,
        estimatedTime: estimatedWaitText,
        countdownRemaining,
        dutyStatus: doc.duty_status
      });
    }

    return result;
  }

  /**
   * Log reprint action
   */
  async recordReprint(tokenId, actorId = 'receptionist') {
    await query('UPDATE queue_tokens SET reprint_count = reprint_count + 1 WHERE id = ?', [tokenId]);
    const tokens = await query('SELECT * FROM queue_tokens WHERE id = ?', [tokenId]);
    if (tokens.length > 0) {
      await query(`
        INSERT INTO audit_logs (id, actor_id, actor_role, action, target_type, target_id, details)
        VALUES (?, ?, 'receptionist', 'REPRINT_TOKEN', 'queue_token', ?, ?)
      `, [uuidv4(), actorId, tokenId, `Reprinted receipt for ${tokens[0].token_number}`]);
    }
  }

  /**
   * ETA calculation formula
   */
  async calculateETA(sessionId, tokenId = null) {
    const sessions = await query('SELECT * FROM clinic_sessions WHERE id = ?', [sessionId]);
    if (sessions.length === 0) return { minutes: 0, patientsAhead: 0 };
    const session = sessions[0];

    const docCounts = await query(`
      SELECT COUNT(*) as count 
      FROM doctors d
      JOIN clinics c ON d.department_id = c.department_id
      WHERE c.id = ? AND d.duty_status = 'ON_DUTY'
    `, [session.clinic_id]);
    const activeDocCount = docCounts[0].count || 1;

    let patientsAhead = 0;
    if (tokenId) {
      const thisTokens = await query('SELECT token_seq, priority FROM queue_tokens WHERE id = ?', [tokenId]);
      if (thisTokens.length > 0) {
        const thisToken = thisTokens[0];
        const aheadRows = await query(`
          SELECT COUNT(*) as count 
          FROM queue_tokens 
          WHERE session_id = ? 
            AND status = 'WAITING' 
            AND (priority > ? OR (priority = ? AND token_seq < ?))
        `, [sessionId, thisToken.priority, thisToken.priority, thisToken.token_seq]);
        patientsAhead = aheadRows[0].count || 0;
      }
    } else {
      const waitRows = await query(`
        SELECT COUNT(*) as count 
        FROM queue_tokens 
        WHERE session_id = ? AND status = 'WAITING'
      `, [sessionId]);
      patientsAhead = waitRows[0].count || 0;
    }

    const avgConsultMinutes = 6;
    const etaMinutes = Math.max(2, Math.ceil((patientsAhead * avgConsultMinutes) / activeDocCount));

    return {
      patientsAhead,
      activeDoctors: activeDocCount,
      estimatedMinutes: etaMinutes,
      confidence: 'Rolling Average (6 min/patient)'
    };
  }

  /**
   * Safe Public TV Display Snapshot
   */
  async getDisplaySnapshot(sessionCode = 'OPD') {
    const sessions = await query("SELECT * FROM clinic_sessions WHERE session_code = ? AND state = 'ACTIVE' ORDER BY session_date DESC LIMIT 1", [sessionCode]);
    if (sessions.length === 0) return { session: null, rooms: [], nextWaiting: null };
    const session = sessions[0];

    const rooms = await query(`
      SELECT r.id as room_id, r.room_number, r.name as room_name,
             d.id as doctor_id, d.name as doctor_name, d.duty_status,
             (SELECT qt.token_number FROM queue_tokens qt 
              WHERE qt.room_id = r.id AND qt.session_id = ? AND qt.status IN ('CALLED', 'ARRIVED', 'IN_CONSULTATION', 'RECALLED', 'AWAITING_PATIENT')
              ORDER BY qt.called_at DESC LIMIT 1) as current_token,
             (SELECT qt.status FROM queue_tokens qt 
              WHERE qt.room_id = r.id AND qt.session_id = ? AND qt.status IN ('CALLED', 'ARRIVED', 'IN_CONSULTATION', 'RECALLED', 'AWAITING_PATIENT')
              ORDER BY qt.called_at DESC LIMIT 1) as token_status
      FROM rooms r
      JOIN clinics c ON r.department_id = c.department_id
      LEFT JOIN doctors d ON (d.current_room_id = r.id AND d.duty_status = 'ON_DUTY')
      WHERE c.id = ?
      ORDER BY r.room_number ASC
    `, [session.id, session.id, session.clinic_id]);

    const nextWaitingRows = await query(`
      SELECT token_number, priority 
      FROM queue_tokens 
      WHERE session_id = ? AND status = 'WAITING'
      ORDER BY priority DESC, token_seq ASC 
      LIMIT 1
    `, [session.id]);

    const waitCounts = await query('SELECT COUNT(*) as count FROM queue_tokens WHERE session_id = ? AND status = "WAITING"', [session.id]);
    const compCounts = await query('SELECT COUNT(*) as count FROM queue_tokens WHERE session_id = ? AND status = "COMPLETED"', [session.id]);

    return {
      session: {
        id: session.id,
        code: session.session_code,
        name: session.session_name,
        date: session.session_date
      },
      rooms: rooms.map(r => ({
        roomNumber: r.room_number,
        roomName: r.room_name,
        doctorName: r.doctor_name || 'Unassigned',
        dutyStatus: r.duty_status || 'OFF_DUTY',
        currentToken: r.current_token || null,
        statusText: r.current_token ? (r.token_status === 'CALLED' ? 'Called (Please Enter)' : (r.token_status === 'ARRIVED' ? 'Patient Arrived' : 'Consulting')) : (r.duty_status === 'ON_DUTY' ? 'Available' : 'Closed')
      })),
      nextWaitingToken: nextWaitingRows.length > 0 ? nextWaitingRows[0].token_number : null,
      waitingCount: waitCounts[0].count || 0,
      completedCount: compCounts[0].count || 0,
      lastUpdated: new Date().toLocaleTimeString()
    };
  }

  /**
   * Longitudinal Patient Medical History & Records
   */
  async getPatientHistory(patientId) {
    const patients = await query('SELECT * FROM patients WHERE id = ?', [patientId]);
    if (patients.length === 0) return null;
    const patient = patients[0];

    const consultations = await query(`
      SELECT c.*, d.name as doctor_name, d.specialization
      FROM consultations c
      JOIN doctors d ON c.doctor_id = d.id
      WHERE c.patient_id = ?
      ORDER BY c.completed_at DESC
    `, [patientId]);

    const history = [];
    for (const c of consultations) {
      const prescriptions = await query('SELECT * FROM prescriptions WHERE consultation_id = ?', [c.id]);
      const labRequests = await query('SELECT * FROM lab_requests WHERE consultation_id = ?', [c.id]);
      history.push({
        ...c,
        prescriptions,
        labRequests
      });
    }

    return {
      patient,
      history
    };
  }
}

module.exports = new QueueManager();
