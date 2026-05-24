const express   = require('express');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const os        = require('os');
const pool      = require('../config/db');
const { superadminAuth }           = require('../middleware/superadminAuth');
const { logSAAction, recordSALoginAttempt } = require('../utils/superadminLogger');

const router = express.Router();

const SA_JWT_SECRET      = () => process.env.SUPERADMIN_JWT_SECRET || process.env.JWT_SECRET;
const SA_SESSION_TIMEOUT = () => process.env.SUPERADMIN_SESSION_TIMEOUT || '30m';

// ─── In-memory brute-force tracker ───────────────────────────────────────────
const ipAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCK_WINDOW  = 15 * 60 * 1000; // 15 min

function isLocked(ip) {
  const now = Date.now();
  const list = (ipAttempts.get(ip) || []).filter(t => now - t < LOCK_WINDOW);
  ipAttempts.set(ip, list);
  return list.length >= MAX_ATTEMPTS;
}
function trackFailure(ip) {
  const list = ipAttempts.get(ip) || [];
  list.push(Date.now());
  ipAttempts.set(ip, list);
}
function clearAttempts(ip) {
  ipAttempts.delete(ip);
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────

router.post('/auth/login', async (req, res) => {
  const ip        = req.ip;
  const ua        = req.headers['user-agent'] || 'unknown';
  const { passkey_id, password } = req.body;

  if (!passkey_id || !password) {
    return res.status(400).json({ success: false, message: 'Missing credentials' });
  }

  if (isLocked(ip)) {
    await recordSALoginAttempt(passkey_id, ip, ua, false, 'RATE_LIMITED');
    return res.status(429).json({ success: false, message: 'Too many attempts. Try again later.' });
  }

  try {
    const [rows] = await pool.query(
      'SELECT * FROM super_admins WHERE passkey_id=? AND is_active=1', [passkey_id]
    );

    if (!rows.length) {
      trackFailure(ip);
      await recordSALoginAttempt(passkey_id, ip, ua, false, 'INVALID_PASSKEY');
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const sa    = rows[0];
    const valid = await bcrypt.compare(password, sa.password);

    if (!valid) {
      trackFailure(ip);
      await recordSALoginAttempt(passkey_id, ip, ua, false, 'INVALID_PASSWORD');
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    clearAttempts(ip);

    const token = jwt.sign(
      { id: sa.id, passkey_id: sa.passkey_id, role: 'superadmin', name: sa.full_name },
      SA_JWT_SECRET(),
      { expiresIn: SA_SESSION_TIMEOUT() }
    );

    await pool.query('UPDATE super_admins SET last_login=CURRENT_TIMESTAMP WHERE id=?', [sa.id]);
    await recordSALoginAttempt(passkey_id, ip, ua, true, null);
    await logSAAction(sa.id, 'SA_LOGIN', `Super Admin logged in`, ip, ua);

    res.json({ success: true, token, name: sa.full_name, passkey_id: sa.passkey_id });
  } catch (err) {
    console.error('[SA Login]', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/auth/me', superadminAuth, async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, passkey_id, full_name, last_login, created_at FROM super_admins WHERE id=?',
    [req.superAdmin.id]
  );
  res.json({ success: true, data: rows[0] || null });
});

router.post('/auth/logout', superadminAuth, async (req, res) => {
  await logSAAction(req.superAdmin.id, 'SA_LOGOUT', 'Super Admin logged out', req.ip, req.headers['user-agent']);
  res.json({ success: true });
});

// ─── STATS ────────────────────────────────────────────────────────────────────

router.get('/stats', superadminAuth, async (req, res) => {
  try {
    const [[totalUsers]]   = await pool.query("SELECT COUNT(*) AS n FROM users");
    const [[totalApps]]    = await pool.query("SELECT COUNT(*) AS n FROM applications");
    const [[pendingApps]]  = await pool.query("SELECT COUNT(*) AS n FROM applications WHERE LOWER(status)='pending'");
    const [[approvedApps]] = await pool.query("SELECT COUNT(*) AS n FROM applications WHERE LOWER(status)='approved'");
    const [[totalCerts]]   = await pool.query("SELECT COUNT(*) AS n FROM certificates");
    const [[openObj]]      = await pool.query("SELECT COUNT(*) AS n FROM objections WHERE LOWER(status)='open'");
    const [[totalNotices]] = await pool.query("SELECT COUNT(*) AS n FROM notices");
    const [[todayAttempts]]= await pool.query(
      "SELECT COUNT(*) AS n FROM superadmin_login_attempts WHERE DATE(created_at)=DATE('now')"
    );
    const [[failedToday]]  = await pool.query(
      "SELECT COUNT(*) AS n FROM superadmin_login_attempts WHERE DATE(created_at)=DATE('now') AND success=0"
    );
    const [[totalUploads]] = await pool.query("SELECT COUNT(*) AS n FROM uploads");

    res.json({
      success: true,
      stats: {
        users: totalUsers.n, applications: totalApps.n, pending: pendingApps.n,
        approved: approvedApps.n, certificates: totalCerts.n, objections: openObj.n,
        notices: totalNotices.n, uploadBatches: totalUploads.n,
        todayLoginAttempts: todayAttempts.n, todayFailedAttempts: failedToday.n
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── USERS ────────────────────────────────────────────────────────────────────

router.get('/users', superadminAuth, async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, username, full_name, role, is_active, created_at FROM users ORDER BY id DESC'
  );
  await logSAAction(req.superAdmin.id, 'VIEW_USERS', 'Viewed all users', req.ip, req.headers['user-agent']);
  res.json({ success: true, data: rows });
});

router.put('/users/:id/toggle', superadminAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT id, username, role FROM users WHERE id=?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ success: false, message: 'User not found' });
  if (rows[0].role === 'admin' && rows[0].id === req.superAdmin.id) {
    return res.status(400).json({ success: false, message: 'Cannot deactivate yourself' });
  }
  await pool.query('UPDATE users SET is_active = 1 - is_active WHERE id=?', [req.params.id]);
  await logSAAction(req.superAdmin.id, 'TOGGLE_USER', `Toggled user ${rows[0].username}`, req.ip, req.headers['user-agent']);
  res.json({ success: true });
});

router.put('/users/:id/reset-password', superadminAuth, async (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
  }
  const hashed = await bcrypt.hash(new_password, 10);
  const [rows] = await pool.query('SELECT username FROM users WHERE id=?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ success: false, message: 'User not found' });
  await pool.query('UPDATE users SET password=? WHERE id=?', [hashed, req.params.id]);
  await logSAAction(req.superAdmin.id, 'RESET_PASSWORD', `Reset password for ${rows[0].username}`, req.ip, req.headers['user-agent']);
  res.json({ success: true });
});

router.post('/users', superadminAuth, async (req, res) => {
  const { username, password, full_name, role } = req.body;
  const allowed = ['admin', 'upload_staff', 'objection_staff'];
  if (!allowed.includes(role)) return res.status(400).json({ success: false, message: 'Invalid role' });
  if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password required' });
  const hashed = await bcrypt.hash(password, 10);
  await pool.query(
    'INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)',
    [username, hashed, full_name || username, role]
  );
  await logSAAction(req.superAdmin.id, 'CREATE_USER', `Created ${username} as ${role}`, req.ip, req.headers['user-agent']);
  res.json({ success: true });
});

router.delete('/users/:id', superadminAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT username, role FROM users WHERE id=?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ success: false, message: 'User not found' });
  if (rows[0].role === 'admin') {
    return res.status(400).json({ success: false, message: 'Cannot delete admin accounts via this route' });
  }
  await pool.query('DELETE FROM users WHERE id=?', [req.params.id]);
  await logSAAction(req.superAdmin.id, 'DELETE_USER', `Deleted ${rows[0].username}`, req.ip, req.headers['user-agent']);
  res.json({ success: true });
});

// ─── APPLICATIONS ─────────────────────────────────────────────────────────────

router.get('/applications', superadminAuth, async (req, res) => {
  const search  = String(req.query.search || '').trim();
  const status  = String(req.query.status || '').trim().toLowerCase();
  const page    = Math.max(parseInt(req.query.page) || 1, 1);
  const limit   = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset  = (page - 1) * limit;
  const where = []; const params = [];

  if (search) {
    where.push('(application_no LIKE ? OR name LIKE ? OR district LIKE ? OR mobile LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) { where.push('LOWER(status)=?'); params.push(status); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM applications ${whereSql}`, params);
  const total = countRows[0]?.total || 0;
  const [rows] = await pool.query(
    `SELECT * FROM applications ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ success: true, data: rows, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } });
});

router.put('/applications/:id', superadminAuth, async (req, res) => {
  const { name, father_name, district, mobile, status } = req.body;
  await pool.query(
    'UPDATE applications SET name=?, father_name=?, district=?, mobile=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
    [name, father_name, district, mobile, status, req.params.id]
  );
  await logSAAction(req.superAdmin.id, 'EDIT_APPLICATION', `Edited app id ${req.params.id}`, req.ip, req.headers['user-agent']);
  res.json({ success: true });
});

router.delete('/applications/:id', superadminAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT application_no FROM applications WHERE id=?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
  await pool.query('DELETE FROM applications WHERE id=?', [req.params.id]);
  await logSAAction(req.superAdmin.id, 'DELETE_APPLICATION', `Deleted app ${rows[0].application_no}`, req.ip, req.headers['user-agent']);
  res.json({ success: true });
});

// ─── CERTIFICATES ─────────────────────────────────────────────────────────────

router.get('/certificates', superadminAuth, async (req, res) => {
  const [rows] = await pool.query(
    'SELECT c.*, a.name, a.district FROM certificates c LEFT JOIN applications a ON c.application_no=a.application_no ORDER BY c.id DESC LIMIT 200'
  );
  res.json({ success: true, data: rows });
});

// ─── NOTICES ──────────────────────────────────────────────────────────────────

router.get('/notices', superadminAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM notices ORDER BY id DESC');
  res.json({ success: true, data: rows });
});

router.post('/notices', superadminAuth, async (req, res) => {
  const { title, content, target_audience } = req.body;
  if (!title) return res.status(400).json({ success: false, message: 'Title required' });
  await pool.query(
    "INSERT INTO notices (title, content, target_audience) VALUES (?, ?, ?)",
    [title, content || '', target_audience || 'public']
  );
  await logSAAction(req.superAdmin.id, 'CREATE_NOTICE', `Created notice: ${title}`, req.ip, req.headers['user-agent']);
  res.json({ success: true });
});

router.delete('/notices/:id', superadminAuth, async (req, res) => {
  await pool.query('DELETE FROM notices WHERE id=?', [req.params.id]);
  await logSAAction(req.superAdmin.id, 'DELETE_NOTICE', `Deleted notice id ${req.params.id}`, req.ip, req.headers['user-agent']);
  res.json({ success: true });
});

// ─── OBJECTIONS ───────────────────────────────────────────────────────────────

router.get('/objections', superadminAuth, async (req, res) => {
  const [rows] = await pool.query(
    'SELECT o.*, a.name, a.district FROM objections o LEFT JOIN applications a ON o.application_no=a.application_no ORDER BY o.id DESC LIMIT 200'
  );
  res.json({ success: true, data: rows });
});

// ─── AUDIT LOGS ───────────────────────────────────────────────────────────────

router.get('/audit-logs', superadminAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 200, 500);
  const [rows] = await pool.query('SELECT * FROM action_logs ORDER BY id DESC LIMIT ?', [limit]);
  res.json({ success: true, data: rows });
});

router.get('/sa-logs', superadminAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 200, 500);
  const [rows] = await pool.query(
    'SELECT l.*, s.passkey_id FROM superadmin_audit_logs l LEFT JOIN super_admins s ON l.super_admin_id=s.id ORDER BY l.id DESC LIMIT ?',
    [limit]
  );
  res.json({ success: true, data: rows });
});

router.get('/login-attempts', superadminAuth, async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM superadmin_login_attempts ORDER BY id DESC LIMIT 300'
  );
  res.json({ success: true, data: rows });
});

// ─── UPLOADS / BACKUPS ────────────────────────────────────────────────────────

router.get('/uploads', superadminAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM uploads ORDER BY id DESC LIMIT 100');
  res.json({ success: true, data: rows });
});

router.get('/backups', superadminAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM backup_logs ORDER BY id DESC LIMIT 50');
  res.json({ success: true, data: rows });
});

// ─── SYSTEM INFO ──────────────────────────────────────────────────────────────

router.get('/system-info', superadminAuth, async (req, res) => {
  const mem  = process.memoryUsage();
  const uptime = process.uptime();

  const days    = Math.floor(uptime / 86400);
  const hours   = Math.floor((uptime % 86400) / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);

  res.json({
    success: true,
    system: {
      nodeVersion:   process.version,
      platform:      process.platform,
      arch:          process.arch,
      uptimeSeconds: Math.floor(uptime),
      uptimeHuman:   `${days}d ${hours}h ${minutes}m ${seconds}s`,
      memoryRSS:     Math.round(mem.rss / 1024 / 1024),
      memoryHeapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      memoryHeapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      cpuCores:      os.cpus().length,
      osPlatform:    os.platform(),
      osRelease:     os.release(),
      totalMemGB:    (os.totalmem() / 1024 / 1024 / 1024).toFixed(2),
      freeMemGB:     (os.freemem()  / 1024 / 1024 / 1024).toFixed(2),
      hostname:      os.hostname(),
      pid:           process.pid,
      port:          process.env.PORT || 5000,
      nodeEnv:       process.env.NODE_ENV || 'development'
    }
  });
});

// ─── ENV CONFIG (safe non-sensitive view) ─────────────────────────────────────

router.get('/env-config', superadminAuth, async (req, res) => {
  const safeKeys = ['PORT', 'NODE_ENV', 'DB_HOST', 'DB_NAME', 'SMS_PROVIDER', 'OTP_EXPIRY_MINUTES', 'SUPERADMIN_SESSION_TIMEOUT'];
  const sensitiveKeys = ['JWT_SECRET', 'SUPERADMIN_JWT_SECRET', 'DB_PASSWORD', 'SUPERADMIN_PASSKEY_ID', 'SUPERADMIN_PASSWORD', 'MSG91_AUTH_KEY', 'FAST2SMS_API_KEY', 'TWILIO_AUTH_TOKEN'];

  const config = {};
  safeKeys.forEach(k => { config[k] = process.env[k] || '(not set)'; });

  const secretsExist = {};
  sensitiveKeys.forEach(k => { secretsExist[k] = !!process.env[k]; });

  await logSAAction(req.superAdmin.id, 'VIEW_ENV_CONFIG', 'Viewed environment config', req.ip, req.headers['user-agent']);
  res.json({ success: true, config, secretsExist });
});

// ─── SECURITY MONITOR ─────────────────────────────────────────────────────────

router.get('/security-monitor', superadminAuth, async (req, res) => {
  const [recentFails] = await pool.query(
    "SELECT ip, COUNT(*) AS attempts, MAX(created_at) AS last_attempt FROM superadmin_login_attempts WHERE success=0 AND created_at > datetime('now','-24 hours') GROUP BY ip ORDER BY attempts DESC LIMIT 20"
  );
  const [lockedIPs] = await pool.query(
    "SELECT ip, COUNT(*) AS attempts FROM superadmin_login_attempts WHERE success=0 AND created_at > datetime('now','-15 minutes') GROUP BY ip HAVING attempts >= 5"
  );
  const [recentSuccess] = await pool.query(
    "SELECT * FROM superadmin_login_attempts WHERE success=1 ORDER BY id DESC LIMIT 10"
  );
  const [suspiciousActions] = await pool.query(
    "SELECT * FROM superadmin_audit_logs ORDER BY id DESC LIMIT 20"
  );

  const activeLockedIPs = [...ipAttempts.entries()]
    .filter(([, times]) => {
      const now = Date.now();
      const recent = times.filter(t => now - t < LOCK_WINDOW);
      return recent.length >= MAX_ATTEMPTS;
    })
    .map(([ip]) => ip);

  res.json({
    success: true,
    recentFailures: recentFails,
    currentlyLocked: activeLockedIPs,
    dbLockedIPs: lockedIPs,
    recentSuccessfulLogins: recentSuccess,
    recentSAActions: suspiciousActions
  });
});

module.exports = router;
