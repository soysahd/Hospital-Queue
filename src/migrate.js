const { query } = require('./db');

async function migrate() {
  console.log('Running database schema migration for Appointments & Schedules...');
  
  await query(`
    CREATE TABLE IF NOT EXISTS doctor_schedules (
      id VARCHAR(64) PRIMARY KEY,
      doctor_id VARCHAR(64) NOT NULL,
      schedule_date DATE NOT NULL,
      start_time VARCHAR(16) NOT NULL,
      end_time VARCHAR(16) NOT NULL,
      break_start VARCHAR(16) NULL,
      break_end VARCHAR(16) NULL,
      hospital_branch VARCHAR(128) DEFAULT 'Main Pavilion - Colombo',
      room_id VARCHAR(64) NULL,
      appointment_duration INT DEFAULT 15,
      max_capacity INT DEFAULT 30,
      status ENUM('AVAILABLE', 'UNAVAILABLE', 'ON_LEAVE', 'ON_BREAK') DEFAULT 'AVAILABLE',
      is_published TINYINT(1) DEFAULT 1,
      booking_disabled TINYINT(1) DEFAULT 0,
      notes TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_doc_date (doctor_id, schedule_date),
      FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  const cols = await query('DESCRIBE appointments');
  const colNames = cols.map(c => c.Field);
  
  if (!colNames.includes('appointment_date')) {
    await query('ALTER TABLE appointments ADD COLUMN appointment_date DATE NULL AFTER session_id');
  }
  if (!colNames.includes('doctor_schedule_id')) {
    await query('ALTER TABLE appointments ADD COLUMN doctor_schedule_id VARCHAR(64) NULL AFTER doctor_id');
  }
  if (!colNames.includes('token_id')) {
    await query('ALTER TABLE appointments ADD COLUMN token_id VARCHAR(64) NULL AFTER doctor_schedule_id');
  }
  if (!colNames.includes('checked_in_at')) {
    await query('ALTER TABLE appointments ADD COLUMN checked_in_at DATETIME NULL');
  }

  const uCols = await query('DESCRIBE users');
  const uColNames = uCols.map(c => c.Field);
  if (!uColNames.includes('email')) {
    await query('ALTER TABLE users ADD COLUMN email VARCHAR(128) NULL AFTER username');
  }
  if (!uColNames.includes('phone')) {
    await query('ALTER TABLE users ADD COLUMN phone VARCHAR(32) NULL AFTER email');
  }

  const dCols = await query('DESCRIBE doctors');
  const dColNames = dCols.map(c => c.Field);
  if (!dColNames.includes('profile_image')) {
    await query('ALTER TABLE doctors ADD COLUMN profile_image VARCHAR(255) NULL');
  }

  console.log('Migration completed successfully!');
}

if (require.main === module) {
  migrate().then(() => process.exit(0)).catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}

module.exports = migrate;
