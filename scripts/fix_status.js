const { query } = require('../src/db');

async function fixSchema() {
  try {
    const cols = await query('SHOW COLUMNS FROM users');
    const hasStatus = cols.some(c => c.Field === 'status');
    if (!hasStatus) {
      await query("ALTER TABLE users ADD COLUMN status ENUM('ACTIVE', 'SUSPENDED', 'DEACTIVATED') DEFAULT 'ACTIVE'");
      console.log('Successfully added status column to users');
    } else {
      console.log('users.status already exists');
    }
    const colsAfter = await query('SHOW COLUMNS FROM users');
    console.log('Columns:', colsAfter.map(c => c.Field));
  } catch (err) {
    console.error('Error fixing schema:', err);
  } finally {
    process.exit(0);
  }
}

fixSchema();
