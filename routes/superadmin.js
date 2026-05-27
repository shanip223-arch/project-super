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

router.get('/registration/config', superadminAuth, async (req, res) => {
  const [rows] = await pool.query("SELECT key, value, updated_at FROM system_config WHERE key LIKE 'registration_%' OR key='invite_only_mode' OR key='dynamic_registration_fields'");
  res.json({ success: true, data: rows });
});

router.put('/registration/config', superadminAuth, async (req, res) => {
  const allowed = new Set(['registration_enabled', 'registration_mode', 'registration_visibility', 'registration_requires_approval', 'invite_only_mode', 'registration_window_active', 'registration_daily_limit', 'dynamic_registration_fields']);
  for (const [key, value] of Object.entries(req.body || {})) {
    if (!allowed.has(key)) continue;
    await pool.query('INSERT INTO system_config(key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP', [key, String(value)]);
  }
  await logSAAction(req.superAdmin.id, 'REGISTRATION_CONFIG_UPDATE', JSON.stringify(req.body || {}), req.ip, req.headers['user-agent']);
  res.json({ success: true });
});

router.get('/registrations', superadminAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM registrations ORDER BY id DESC LIMIT 500');
  res.json({ success: true, data: rows });
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

// ─── SYSTEM CONFIG ────────────────────────────────────────────────────────────

router.get('/system-config', superadminAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM sa_system_config ORDER BY category, id');
    await logSAAction(req.superAdmin.id, 'VIEW_SYSTEM_CONFIG', 'Viewed system config', req.ip, req.headers['user-agent']);
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/system-config/:key', superadminAuth, async (req, res) => {
  try {
    const { config_value } = req.body;
    const key = req.params.key;
    const [rows] = await pool.query('SELECT id FROM sa_system_config WHERE config_key=?', [key]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Config key not found' });
    await pool.query(
      'UPDATE sa_system_config SET config_value=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE config_key=?',
      [String(config_value), req.superAdmin.passkey_id, key]
    );
    await logSAAction(req.superAdmin.id, 'UPDATE_CONFIG', `Updated config: ${key} = ${config_value}`, req.ip, req.headers['user-agent']);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─── FEATURE FLAGS ────────────────────────────────────────────────────────────

router.get('/feature-flags', superadminAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM sa_feature_flags ORDER BY category, sort_order, id');
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/feature-flags', superadminAuth, async (req, res) => {
  try {
    const { feature_key, label, description, enabled, roles, is_beta, category } = req.body;
    if (!feature_key || !label) return res.status(400).json({ success: false, message: 'feature_key and label required' });
    const [ex] = await pool.query('SELECT id FROM sa_feature_flags WHERE feature_key=?', [feature_key]);
    if (ex.length) return res.status(400).json({ success: false, message: 'Feature key already exists' });
    await pool.query(
      'INSERT INTO sa_feature_flags (feature_key,label,description,enabled,roles,is_beta,category) VALUES (?,?,?,?,?,?,?)',
      [feature_key, label, description || '', enabled ? 1 : 0, roles || 'all', is_beta ? 1 : 0, category || 'general']
    );
    await logSAAction(req.superAdmin.id, 'CREATE_FEATURE_FLAG', `Created feature: ${feature_key}`, req.ip, req.headers['user-agent']);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/feature-flags/:id', superadminAuth, async (req, res) => {
  try {
    const { label, description, enabled, roles, is_beta, category } = req.body;
    const [rows] = await pool.query('SELECT * FROM sa_feature_flags WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    const r = rows[0];
    await pool.query(
      'UPDATE sa_feature_flags SET label=?,description=?,enabled=?,roles=?,is_beta=?,category=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',
      [
        label ?? r.label,
        description ?? r.description,
        enabled !== undefined ? (enabled ? 1 : 0) : r.enabled,
        roles ?? r.roles,
        is_beta !== undefined ? (is_beta ? 1 : 0) : r.is_beta,
        category ?? r.category,
        req.params.id
      ]
    );
    await logSAAction(req.superAdmin.id, 'UPDATE_FEATURE_FLAG', `Updated feature id ${req.params.id}`, req.ip, req.headers['user-agent']);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/feature-flags/:id', superadminAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT feature_key FROM sa_feature_flags WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    await pool.query('DELETE FROM sa_feature_flags WHERE id=?', [req.params.id]);
    await logSAAction(req.superAdmin.id, 'DELETE_FEATURE_FLAG', `Deleted feature: ${rows[0].feature_key}`, req.ip, req.headers['user-agent']);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─── DASHBOARD SECTION CONTROL ────────────────────────────────────────────────

router.get('/dashboard-sections', superadminAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM sa_dashboard_sections ORDER BY roles, sort_order, id');
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/dashboard-sections', superadminAuth, async (req, res) => {
  try {
    const { section_key, label, description, roles, enabled, pinned, icon, sort_order } = req.body;
    if (!section_key || !label) return res.status(400).json({ success: false, message: 'section_key and label required' });
    await pool.query(
      'INSERT INTO sa_dashboard_sections (section_key,label,description,roles,enabled,pinned,icon,sort_order) VALUES (?,?,?,?,?,?,?,?)',
      [section_key, label, description || '', roles || 'all', enabled !== false ? 1 : 0, pinned ? 1 : 0, icon || '▣', parseInt(sort_order) || 0]
    );
    await logSAAction(req.superAdmin.id, 'CREATE_DASHBOARD_SECTION', `Created section: ${section_key}`, req.ip, req.headers['user-agent']);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/dashboard-sections/:id', superadminAuth, async (req, res) => {
  try {
    const { label, description, roles, enabled, pinned, icon, sort_order } = req.body;
    const [rows] = await pool.query('SELECT * FROM sa_dashboard_sections WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    const r = rows[0];
    await pool.query(
      'UPDATE sa_dashboard_sections SET label=?,description=?,roles=?,enabled=?,pinned=?,icon=?,sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',
      [
        label ?? r.label,
        description ?? r.description,
        roles ?? r.roles,
        enabled !== undefined ? (enabled ? 1 : 0) : r.enabled,
        pinned !== undefined ? (pinned ? 1 : 0) : r.pinned,
        icon ?? r.icon,
        sort_order !== undefined ? parseInt(sort_order) : r.sort_order,
        req.params.id
      ]
    );
    await logSAAction(req.superAdmin.id, 'UPDATE_DASHBOARD_SECTION', `Updated section id ${req.params.id}`, req.ip, req.headers['user-agent']);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/dashboard-sections/:id', superadminAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT section_key FROM sa_dashboard_sections WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    await pool.query('DELETE FROM sa_dashboard_sections WHERE id=?', [req.params.id]);
    await logSAAction(req.superAdmin.id, 'DELETE_DASHBOARD_SECTION', `Deleted section: ${rows[0].section_key}`, req.ip, req.headers['user-agent']);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─── ANNOUNCEMENTS ────────────────────────────────────────────────────────────

router.get('/announcements', superadminAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM sa_announcements ORDER BY id DESC');
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/announcements', superadminAuth, async (req, res) => {
  try {
    const { title, content, type, target_roles, is_active, start_at, end_at } = req.body;
    if (!title) return res.status(400).json({ success: false, message: 'Title required' });
    const validTypes = ['banner', 'popup', 'scroll', 'alert'];
    const aType = validTypes.includes(type) ? type : 'banner';
    await pool.query(
      'INSERT INTO sa_announcements (title,content,type,target_roles,is_active,start_at,end_at,created_by) VALUES (?,?,?,?,?,?,?,?)',
      [title, content || '', aType, target_roles || 'all', is_active !== false ? 1 : 0, start_at || null, end_at || null, req.superAdmin.passkey_id]
    );
    await logSAAction(req.superAdmin.id, 'CREATE_ANNOUNCEMENT', `Created: ${title}`, req.ip, req.headers['user-agent']);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/announcements/:id', superadminAuth, async (req, res) => {
  try {
    const { title, content, type, target_roles, is_active, start_at, end_at } = req.body;
    const [rows] = await pool.query('SELECT * FROM sa_announcements WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    const r = rows[0];
    const validTypes = ['banner', 'popup', 'scroll', 'alert'];
    const aType = type && validTypes.includes(type) ? type : r.type;
    await pool.query(
      'UPDATE sa_announcements SET title=?,content=?,type=?,target_roles=?,is_active=?,start_at=?,end_at=? WHERE id=?',
      [title ?? r.title, content ?? r.content, aType, target_roles ?? r.target_roles,
       is_active !== undefined ? (is_active ? 1 : 0) : r.is_active,
       start_at !== undefined ? start_at : r.start_at,
       end_at !== undefined ? end_at : r.end_at,
       req.params.id]
    );
    await logSAAction(req.superAdmin.id, 'UPDATE_ANNOUNCEMENT', `Updated announcement id ${req.params.id}`, req.ip, req.headers['user-agent']);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/announcements/:id', superadminAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT title FROM sa_announcements WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    await pool.query('DELETE FROM sa_announcements WHERE id=?', [req.params.id]);
    await logSAAction(req.superAdmin.id, 'DELETE_ANNOUNCEMENT', `Deleted: ${rows[0].title}`, req.ip, req.headers['user-agent']);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─── ACTIVITY MONITOR ─────────────────────────────────────────────────────────

router.get('/activity', superadminAuth, async (req, res) => {
  try {
    const limit     = Math.min(parseInt(req.query.limit) || 100, 300);
    const roleFilter = req.query.role || '';
    const whereRole  = roleFilter ? 'WHERE role=?' : '';
    const rp         = roleFilter ? [roleFilter] : [];

    const [recentActivity] = await pool.query(
      `SELECT id, created_at, role, action, details, ip_address AS ip FROM action_logs ${whereRole} ORDER BY id DESC LIMIT ?`,
      [...rp, limit]
    );
    const [loginsByRole] = await pool.query(
      `SELECT role, COUNT(*) AS total FROM action_logs WHERE action='LOGIN' AND created_at > datetime('now','-24 hours') GROUP BY role`
    );
    const [topActions] = await pool.query(
      `SELECT action, COUNT(*) AS count FROM action_logs WHERE created_at > datetime('now','-7 days') GROUP BY action ORDER BY count DESC LIMIT 15`
    );
    const [failedLogins] = await pool.query(
      `SELECT ip, COUNT(*) AS attempts, MAX(created_at) AS last_try FROM superadmin_login_attempts WHERE success=0 AND created_at > datetime('now','-24 hours') GROUP BY ip ORDER BY attempts DESC LIMIT 10`
    );
    const [saRecent] = await pool.query(
      `SELECT l.*, s.passkey_id FROM superadmin_audit_logs l LEFT JOIN super_admins s ON l.super_admin_id=s.id ORDER BY l.id DESC LIMIT 20`
    );
    const [hourlyActivity] = await pool.query(
      `SELECT strftime('%H:00',created_at) AS hour, COUNT(*) AS count FROM action_logs WHERE created_at > datetime('now','-24 hours') GROUP BY hour ORDER BY hour`
    );

    res.json({ success: true, recentActivity, loginsByRole, topActions, failedLogins, saRecentActivity: saRecent, hourlyActivity });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─── MAINTENANCE MODE (quick toggle) ─────────────────────────────────────────

router.get('/maintenance', superadminAuth, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT config_value FROM sa_system_config WHERE config_key='maintenance_mode'");
    const mode = rows[0]?.config_value === 'true';
    res.json({ success: true, maintenance: mode });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/maintenance', superadminAuth, async (req, res) => {
  try {
    const { enabled } = req.body;
    const val = enabled ? 'true' : 'false';
    await pool.query(
      "UPDATE sa_system_config SET config_value=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE config_key='maintenance_mode'",
      [val, req.superAdmin.passkey_id]
    );
    await logSAAction(req.superAdmin.id, 'SET_MAINTENANCE', `Maintenance mode: ${val}`, req.ip, req.headers['user-agent']);
    res.json({ success: true, maintenance: enabled });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
