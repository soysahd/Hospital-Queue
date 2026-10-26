const { query } = require('../src/db');
const { v4: uuidv4 } = require('uuid');

async function setupSchedulesTable() {
  console.log('Setting up doctor_schedules table...');
  await query(`
    CREATE TABLE IF NOT EXISTS doctor_schedules (
      id VARCHAR(64) PRIMARY KEY,
      doctor_id VARCHAR(64) NOT NULL,
      working_date DATE NOT NULL,
      start_time VARCHAR(8) NOT NULL,
      end_time VARCHAR(8) NOT NULL,
      break_start VARCHAR(8) NULL,
      break_end VARCHAR(8) NULL,
      slot_duration_mins INT DEFAULT 15,
      max_capacity INT DEFAULT 20,
      room_id VARCHAR(64) NULL,
      branch_name VARCHAR(128) DEFAULT 'Main Colombo Campus Hospital',
      status ENUM('AVAILABLE', 'UNAVAILABLE', 'ON_LEAVE', 'ON_BREAK') DEFAULT 'AVAILABLE',
      booking_disabled TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_doc_date (doctor_id, working_date),
      FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  console.log('doctor_schedules table ready.');

  // Also enhance appointments table with appointment_date, start_time, end_time, room_id if not present
  const apptCols = await query('SHOW COLUMNS FROM appointments');
  const colNames = apptCols.map(c => c.Field);

  if (!colNames.includes('appointment_date')) {
    await query('ALTER TABLE appointments ADD COLUMN appointment_date DATE NULL AFTER session_id');
    console.log('Added appointment_date to appointments');
  }
  if (!colNames.includes('room_id')) {
    await query('ALTER TABLE appointments ADD COLUMN room_id VARCHAR(64) NULL AFTER doctor_id');
    console.log('Added room_id to appointments');
  }
  if (!colNames.includes('end_time')) {
    await query('ALTER TABLE appointments ADD COLUMN end_time VARCHAR(16) NULL AFTER scheduled_time');
    console.log('Added end_time to appointments');
  }

  // Update status enum for appointments to include CONFIRMED, COMPLETED, CALLED, ARRIVED, IN_CONSULTATION
  await query(`
    ALTER TABLE appointments MODIFY COLUMN status ENUM(
      'APPOINTED', 'CONFIRMED', 'CHECKED_IN', 'CALLED', 'ARRIVED', 'IN_CONSULTATION', 'COMPLETED', 'CANCELLED', 'MISSED', 'RESCHEDULED'
    ) DEFAULT 'CONFIRMED'
  `);
  console.log('Updated appointments status ENUM');

  // Seed default working schedules for all doctors for This Week and Next Week (14 days)
  const existingCount = (await query('SELECT COUNT(*) as cnt FROM doctor_schedules'))[0].cnt;
  if (existingCount === 0) {
    console.log('Populating schedules for this week and next week...');
    const doctors = await query('SELECT * FROM doctors');
    const today = new Date();

    for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + dayOffset);
      const dateStr = targetDate.toISOString().split('T')[0];
      const dayOfWeek = targetDate.getDay(); // 0 is Sunday, 6 is Saturday

      for (const doc of doctors) {
        // Assign 5 weekdays or alternate days
        const isOff = (dayOfWeek === 0 && doc.id !== 'doc-3') || (dayOfWeek === 6 && doc.id === 'doc-5');
        const status = isOff ? 'UNAVAILABLE' : 'AVAILABLE';
        const start = doc.id === 'doc-3' ? '08:00' : (doc.id === 'doc-6' ? '08:30' : '09:00');
        const end = doc.id === 'doc-3' ? '18:00' : (doc.id === 'doc-6' ? '16:00' : '15:00');
        const bStart = '12:30';
        const bEnd = '13:30';

        await query(`
          INSERT INTO doctor_schedules (
            id, doctor_id, working_date, start_time, end_time, break_start, break_end,
            slot_duration_mins, max_capacity, room_id, branch_name, status, booking_disabled
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 15, 20, ?, 'Main Colombo Campus Hospital', ?, ?)
          ON DUPLICATE KEY UPDATE status = VALUES(status)
        `, [
          uuidv4(), doc.id, dateStr, start, end, bStart, bEnd,
          doc.default_room_id || doc.current_room_id, status, isOff ? 1 : 0
        ]);
      }
    }
    console.log('Doctor schedules seeded for 14 days!');
  } else {
    console.log(`doctor_schedules already contains ${existingCount} records.`);
  }

  // Update existing appointments without appointment_date to today
  const todayStr = new Date().toISOString().split('T')[0];
  await query('UPDATE appointments SET appointment_date = ? WHERE appointment_date IS NULL', [todayStr]);
  await query('UPDATE appointments SET status = "CONFIRMED" WHERE status = "APPOINTED"');

  console.log('Migration & Seeding completed successfully!');
  process.exit(0);
}

setupSchedulesTable().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
