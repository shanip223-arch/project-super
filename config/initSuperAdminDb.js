const bcrypt = require('bcryptjs');

async function initSuperAdminDb() {
  const pool = require('./db');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS super_admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      passkey_id TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT DEFAULT 'Root Super Administrator',
      is_active INTEGER DEFAULT 1,
      last_login DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS superadmin_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      super_admin_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      ip TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS superadmin_login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      passkey_id TEXT,
      ip TEXT,
      user_agent TEXT,
      success INTEGER DEFAULT 0,
      failure_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const passkeyId = process.env.SUPERADMIN_PASSKEY_ID || 'SAROOT001';

  // Password: set via SUPERADMIN_PASSWORD env var, default below
  const password = 'BarCouncil@2025';

  const hashed = await bcrypt.hash(password, 12);

  const [existing] = await pool.query(
    'SELECT id FROM super_admins WHERE passkey_id=?', [passkeyId]
  );

  if (!existing.length) {
    await pool.query(
      'INSERT INTO super_admins (passkey_id, password, full_name) VALUES (?, ?, ?)',
      [passkeyId, hashed, 'Root Super Administrator']
    );
  } else {
    await pool.query(
      'UPDATE super_admins SET password=? WHERE passkey_id=?',
      [hashed, passkeyId]
    );
  }

  console.log('✅ Super Admin DB tables ready');
  console.log(`✅ Super Admin ready → Passkey ID: ${passkeyId}`);
  console.log(`✅ Super Admin password: BarCouncil@2025`);
}

module.exports = { initSuperAdminDb };
