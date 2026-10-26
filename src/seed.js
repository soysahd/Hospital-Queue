const { query, getConnection } = require('./db');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

async function seedDatabase() {
  try {
    const migrate = require('./migrate');
    const seedSchedules = require('./seedSchedules');
    await migrate();
    const schedCount = (await query('SELECT COUNT(*) as count FROM doctor_schedules'))[0].count;
    if (schedCount === 0) {
      await seedSchedules();
    }

    const usersCount = await query('SELECT COUNT(*) as count FROM users');
    if (usersCount[0].count > 0) {
      console.log('MySQL database already populated. Checking care tasks and notifications.');
      const taskCount = (await query('SELECT COUNT(*) as count FROM care_tasks'))[0].count;
      if (taskCount === 0) {
        await seedCareTasksAndNotifications();
      }
      return;
    }

    console.log('Seeding comprehensive MySQL hospital database...');
    const conn = await getConnection();
    await conn.beginTransaction();

    try {
      // 1. Departments
      const deptOpdId = 'dept-opd-01';
      const deptInfectId = 'dept-infect-02';
      await conn.execute(
        'INSERT INTO departments (id, code, name, description) VALUES (?, ?, ?, ?)',
        [deptOpdId, 'OPD_DEPT', 'Outpatient Department', 'General OPD Consultation & Triage']
      );
      await conn.execute(
        'INSERT INTO departments (id, code, name, description) VALUES (?, ?, ?, ?)',
        [deptInfectId, 'IDH_CLINIC', 'Specialist Infection Clinics', 'Infectious Diseases & Viral Fevers']
      );

      // 2. Clinics
      const clinicOpdId = 'clinic-opd-01';
      const clinicFeverId = 'clinic-fever-02';
      await conn.execute(
        'INSERT INTO clinics (id, department_id, code, name) VALUES (?, ?, ?, ?)',
        [clinicOpdId, deptOpdId, 'OPD', 'General OPD Service']
      );
      await conn.execute(
        'INSERT INTO clinics (id, department_id, code, name) VALUES (?, ?, ?, ?)',
        [clinicFeverId, deptInfectId, 'CL-A', 'Fever & Tropical Clinic A']
      );

      // 3. Rooms
      const rooms = [
        { id: 'room-01', no: 'Room 01', name: 'OPD Consultation Room 1', dept: deptOpdId },
        { id: 'room-02', no: 'Room 02', name: 'OPD Consultation Room 2', dept: deptOpdId },
        { id: 'room-03', no: 'Room 03', name: 'OPD Consultation Room 3', dept: deptOpdId },
        { id: 'room-04', no: 'Room 04', name: 'OPD Consultation Room 4', dept: deptOpdId },
        { id: 'room-05', no: 'Room 05', name: 'OPD Consultation Room 5', dept: deptOpdId },
        { id: 'room-cl-a1', no: 'Clinic A Room 1', name: 'Specialist Clinic A - Suite 1', dept: deptInfectId },
        { id: 'room-cl-a2', no: 'Clinic A Room 2', name: 'Specialist Clinic A - Suite 2', dept: deptInfectId },
      ];
      for (const r of rooms) {
        await conn.execute('INSERT INTO rooms (id, room_number, name, department_id) VALUES (?, ?, ?, ?)', [r.id, r.no, r.name, r.dept]);
      }

      // 4. Dated Sessions
      const today = new Date().toISOString().split('T')[0];
      const sessionOpdId = 'session-opd-today';
      const sessionClinicAId = 'session-clinic-a-today';
      await conn.execute(
        'INSERT INTO clinic_sessions (id, clinic_id, session_name, session_code, session_date, start_time, end_time, capacity, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [sessionOpdId, clinicOpdId, 'Daily General OPD Queue', 'OPD', today, '08:00', '18:00', 300, 'ACTIVE']
      );
      await conn.execute(
        'INSERT INTO clinic_sessions (id, clinic_id, session_name, session_code, session_date, start_time, end_time, capacity, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [sessionClinicAId, clinicFeverId, 'Specialist Fever Session A', 'CL-A', today, '08:30', '16:00', 100, 'ACTIVE']
      );

      // 5. Default Passwords
      const adminHash = await bcrypt.hash('Admin@123', 10);
      const doctorHash = await bcrypt.hash('Doctor@123', 10);
      const patientHash = await bcrypt.hash('Patient@123', 10);
      const staffHash = await bcrypt.hash('Staff@123', 10);

      // System Users
      await conn.execute(
        'INSERT INTO users (id, username, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?)',
        ['user-admin-1', 'admin', adminHash, 'Dr. K. Silva (Medical Superintendent)', 'admin']
      );
      await conn.execute(
        'INSERT INTO users (id, username, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?)',
        ['user-reception-1', 'reception', staffHash, 'Sunil Perera (Reception Desk 1)', 'receptionist']
      );
      await conn.execute(
        'INSERT INTO users (id, username, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?)',
        ['user-records-1', 'records', staffHash, 'M. Fernando (Medical Records Dept)', 'records']
      );
      await conn.execute(
        'INSERT INTO users (id, username, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?)',
        ['user-lab-1', 'labstaff', staffHash, 'K. Samarasinghe (Pathology Laboratory)', 'lab']
      );

      // 6. Doctors (1-5 + Clinic A)
      const docData = [
        { id: 'doc-1', username: 'doctor1', name: 'Dr. Nirmal Jayasuriya', spec: 'General Medicine / OPD Lead', room: 'room-01', dept: deptOpdId },
        { id: 'doc-2', username: 'doctor2', name: 'Dr. Chathurika Mendis', spec: 'Internal Medicine', room: 'room-02', dept: deptOpdId },
        { id: 'doc-3', username: 'doctor3', name: 'Dr. Hasitha Gunasekara', spec: 'Emergency & Triage', room: 'room-03', dept: deptOpdId },
        { id: 'doc-4', username: 'doctor4', name: 'Dr. Priyantha Dissanayake', spec: 'Infectious Disease Specialist', room: 'room-04', dept: deptOpdId },
        { id: 'doc-5', username: 'doctor5', name: 'Dr. Dilki Senanayake', spec: 'Primary Care Physician', room: 'room-05', dept: deptOpdId },
        { id: 'doc-6', username: 'doctor6', name: 'Dr. Rohan De Silva (Clinic A)', spec: 'Consultant Epidemiologist', room: 'room-cl-a1', dept: deptInfectId },
      ];

      for (const d of docData) {
        const uId = `user-${d.username}`;
        await conn.execute(
          'INSERT INTO users (id, username, password_hash, full_name, role, doctor_id) VALUES (?, ?, ?, ?, ?, ?)',
          [uId, d.username, doctorHash, d.name, 'doctor', d.id]
        );
        await conn.execute(
          'INSERT INTO doctors (id, user_id, name, specialization, department_id, default_room_id, duty_status, current_room_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [d.id, uId, d.name, d.spec, d.dept, d.room, 'ON_DUTY', d.room]
        );
      }

      // 7. Patients
      const patients = [
        { id: 'pat-001', hNo: 'PAT-000123', user: 'patient1', name: 'Kamal Jayawardena', dob: '1984-05-12', gender: 'Male', phone: '0771234567', blood: 'B+', allergies: 'Penicillin (mild rash)' },
        { id: 'pat-002', hNo: 'PAT-000124', user: 'patient2', name: 'Nimali Fonseka', dob: '1992-11-23', gender: 'Female', phone: '0719876543', blood: 'O+', allergies: 'None known' },
        { id: 'pat-003', hNo: 'PAT-000125', user: 'patient3', name: 'Dinesh Weerasinghe', dob: '1978-02-17', gender: 'Male', phone: '0754433221', blood: 'A+', allergies: 'Sulfa drugs' },
        { id: 'pat-004', hNo: 'PAT-000126', user: 'patient4', name: 'Sanduni Gamage', dob: '2001-08-30', gender: 'Female', phone: '0783322110', blood: 'AB+', allergies: 'None known' },
        { id: 'pat-005', hNo: 'PAT-000127', user: 'patient5', name: 'Anura Bandara', dob: '1965-04-05', gender: 'Male', phone: '0705544332', blood: 'O-', allergies: 'Aspirin' },
        { id: 'pat-006', hNo: 'PAT-000128', user: 'patient6', name: 'Rasika Kumari', dob: '1989-12-14', gender: 'Female', phone: '0778899001', blood: 'B-', allergies: 'None known' },
        { id: 'pat-007', hNo: 'PAT-000129', user: 'patient7', name: 'Kasun Wickramasinghe', dob: '1995-07-21', gender: 'Male', phone: '0761122334', blood: 'A-', allergies: 'None known' },
        { id: 'pat-008', hNo: 'PAT-000130', user: 'patient8', name: 'Hiruni Rodrigo', dob: '1999-03-10', gender: 'Female', phone: '0726655443', blood: 'O+', allergies: 'None known' },
      ];

      for (const p of patients) {
        await conn.execute(
          'INSERT INTO patients (id, hospital_number, name, dob, gender, phone, blood_group, allergies) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [p.id, p.hNo, p.name, p.dob, p.gender, p.phone, p.blood, p.allergies]
        );
        await conn.execute(
          'INSERT INTO patient_barcodes (id, patient_id, barcode_value) VALUES (?, ?, ?)',
          [uuidv4(), p.id, p.hNo]
        );
        await conn.execute(
          'INSERT INTO users (id, username, password_hash, full_name, role, patient_id) VALUES (?, ?, ?, ?, ?, ?)',
          [`user-${p.user}`, p.user, patientHash, p.name, 'patient', p.id]
        );
      }

      // 8. Appointments
      await conn.execute(
        'INSERT INTO appointments (id, reference, patient_id, session_id, doctor_id, source, status, scheduled_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [uuidv4(), 'APT-20261016-0081', 'pat-001', sessionOpdId, 'doc-1', 'MOBILE', 'APPOINTED', '09:30']
      );
      await conn.execute(
        'INSERT INTO appointments (id, reference, patient_id, session_id, doctor_id, source, status, scheduled_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [uuidv4(), 'APT-20261016-0092', 'pat-002', sessionClinicAId, 'doc-6', 'PHONE', 'APPOINTED', '10:00']
      );

      // 9. Past Visit & Consultation for Kamal Jayawardena (pat-001)
      const pastVisitId = 'vis-past-001';
      await conn.execute(
        'INSERT INTO visits (id, visit_reference, patient_id, appointment_id, session_id, arrival_time) VALUES (?, ?, ?, ?, ?, ?)',
        [pastVisitId, 'VIS-PAST-001', 'pat-001', null, sessionOpdId, '2026-09-15 10:00:00']
      );

      const pastConsultId = 'consult-past-001';
      await conn.execute(
        `INSERT INTO consultations (
          id, visit_id, patient_id, doctor_id, symptoms, diagnosis, 
          clinical_notes, recommendations, follow_up_advice, started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pastConsultId,
          pastVisitId,
          'pat-001',
          'doc-1',
          'High grade fever, chills, body ache for 3 days',
          'Dengue Viral Fever - Early Phase',
          'Patient hydrated with oral electrolytes. Platelet count monitored daily. Advised complete bed rest.',
          'Drink at least 2.5L of oral fluids daily (King coconut water, ORS, soup). Strictly avoid NSAIDs like Brufen.',
          'Attend follow-up repeat Full Blood Count in 48 hours to inspect platelet trajectory.',
          '2026-09-15 10:15:00',
          '2026-09-15 10:30:00'
        ]
      );

      await conn.execute(
        'INSERT INTO prescriptions (id, consultation_id, item_name, dosage, frequency, duration, instructions) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [uuidv4(), pastConsultId, 'Paracetamol 500mg', '1-2 tablets', 'TDS (Three times a day)', '3 days', 'Take after meals. Strictly no NSAIDs.']
      );
      await conn.execute(
        'INSERT INTO prescriptions (id, consultation_id, item_name, dosage, frequency, duration, instructions) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [uuidv4(), pastConsultId, 'Oral Rehydration Salts (ORS)', '1 sachet in 1L water', 'Sip continuously', '4 days', 'Ensure adequate fluid balance.']
      );

      const pastLabId = 'lab-past-001';
      await conn.execute(
        'INSERT INTO lab_requests (id, consultation_id, patient_id, doctor_id, test_name, urgency, status, results, verified_by, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [pastLabId, pastConsultId, 'pat-001', 'doc-1', 'Full Blood Count (FBC) + Platelets', 'URGENT', 'RESULT_RELEASED', 'WBC: 3.2 x 10^3/uL (Low), Platelets: 135,000/uL, Hct: 41%', 'user-lab-1', '2026-09-15 12:00:00']
      );
      await conn.execute(
        'INSERT INTO lab_requests (id, consultation_id, patient_id, doctor_id, test_name, urgency, status, results, verified_by, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [uuidv4(), pastConsultId, 'pat-001', 'doc-1', 'Dengue NS1 Antigen', 'STAT', 'RESULT_RELEASED', 'Positive (Acute Dengue Infection)', 'user-lab-1', '2026-09-15 11:30:00']
      );

      await conn.commit();
      console.log('Base hospital database seeded.');
      await seedCareTasksAndNotifications();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (error) {
    console.error('Error during database seeding:', error);
  }
}

async function seedCareTasksAndNotifications() {
  console.log('Seeding initial care tasks and patient notifications...');
  try {
    // 1. Care Tasks for Kamal Jayawardena (pat-001)
    const task1Id = 'task-001';
    const task2Id = 'task-002';
    const task3Id = 'task-003';

    await query(`
      INSERT IGNORE INTO care_tasks (
        id, patient_id, doctor_id, consultation_id, title, description, 
        task_type, due_date, status
      ) VALUES 
      (?, 'pat-001', 'doc-1', 'consult-past-001', 'Complete Repeat Full Blood Count (Platelet Check)', 'Attend the Pathology Laboratory for Day-4 platelet count tracking.', 'LAB_TEST', DATE_ADD(CURDATE(), INTERVAL 1 DAY), 'PENDING'),
      (?, 'pat-001', 'doc-1', 'consult-past-001', 'Attend Dengue Follow-Up Consultation', 'Meet Dr. Nirmal Jayasuriya in Room 01 for vitals and hydration review.', 'FOLLOW_UP_APPT', DATE_ADD(CURDATE(), INTERVAL 2 DAY), 'PENDING'),
      (?, 'pat-001', 'doc-1', 'consult-past-001', 'Acknowledge Fluid Balance Instructions', 'Review and follow the 2.5L daily oral fluid balance chart.', 'RECOMMENDATION_ACK', CURDATE(), 'VERIFIED_COMPLETED')
    `, [task1Id, task2Id, task3Id]);

    // 2. Notifications for Kamal Jayawardena
    await query(`
      INSERT IGNORE INTO notifications (id, patient_id, title, message, category, is_read)
      VALUES 
      (?, 'pat-001', 'Appointment Scheduled', 'Your consultation with Dr. Nirmal Jayasuriya is scheduled for today at 09:30 AM.', 'APPOINTMENT', 1),
      (?, 'pat-001', 'Laboratory Investigation Requested', 'Dr. Nirmal Jayasuriya has requested a Repeat Full Blood Count. Please attend the sample collection counter.', 'CARE_TASK', 0),
      (?, 'pat-001', 'Doctor Recommendation Added', 'New home-care fluid guidelines and precautions have been documented in your care plan.', 'RECOMMENDATION', 0)
    `, [uuidv4(), uuidv4(), uuidv4()]);

    console.log('Care tasks and notifications successfully initialized.');
  } catch (e) {
    console.error('Error seeding tasks:', e);
  }
}

module.exports = seedDatabase;
