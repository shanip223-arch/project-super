const pool = require('../config/db');

async function logSAAction(superAdminId, action, details, ip, userAgent) {
  try {
    await pool.query(
      'INSERT INTO superadmin_audit_logs (super_admin_id, action, details, ip, user_agent) VALUES (?, ?, ?, ?, ?)',
      [superAdminId || null, action, details || null, ip || 'unknown', userAgent || 'unknown']
    );
  } catch (err) {
    console.error('[SA Logger]', err.message);
  }
}

async function recordSALoginAttempt(passkeyId, ip, userAgent, success, failureReason) {
  try {
    await pool.query(
      'INSERT INTO superadmin_login_attempts (passkey_id, ip, user_agent, success, failure_reason) VALUES (?, ?, ?, ?, ?)',
      [passkeyId || 'unknown', ip || 'unknown', userAgent || 'unknown', success ? 1 : 0, failureReason || null]
    );
  } catch (err) {
    console.error('[SA Attempt Logger]', err.message);
  }
}

module.exports = { logSAAction, recordSALoginAttempt };
