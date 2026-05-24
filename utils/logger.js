const pool = require('../config/db');

async function logAction(userId, role, action, details, ip) {
  try {
    await pool.query(
      "INSERT INTO action_logs (user_id, role, action, details, ip_address) VALUES (?, ?, ?, ?, ?)",
      [userId || null, role || null, action, details || null, ip || null]
    );
  } catch (err) {
    console.error('Log error:', err);
  }
}
module.exports = { logAction };