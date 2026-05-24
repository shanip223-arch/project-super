const bcrypt = require('bcryptjs');

async function initSuperAdminDb() {
  const pool = require('./db');

  // ── Existing tables ─────────────────────────────────────────────────────────

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

  // ── New: System Configuration ───────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sa_system_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      config_key   TEXT UNIQUE NOT NULL,
      config_value TEXT,
      config_type  TEXT DEFAULT 'string',
      description  TEXT,
      category     TEXT DEFAULT 'general',
      updated_by   TEXT DEFAULT 'system',
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── New: Feature Flags ──────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sa_feature_flags (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      feature_key TEXT UNIQUE NOT NULL,
      label       TEXT NOT NULL,
      description TEXT,
      enabled     INTEGER DEFAULT 1,
      roles       TEXT DEFAULT 'all',
      is_beta     INTEGER DEFAULT 0,
      category    TEXT DEFAULT 'general',
      sort_order  INTEGER DEFAULT 0,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── New: Dashboard Section Control ─────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sa_dashboard_sections (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      section_key TEXT NOT NULL,
      label       TEXT NOT NULL,
      description TEXT,
      roles       TEXT DEFAULT 'all',
      enabled     INTEGER DEFAULT 1,
      pinned      INTEGER DEFAULT 0,
      sort_order  INTEGER DEFAULT 0,
      icon        TEXT DEFAULT '▣',
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── New: Announcements ─────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sa_announcements (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      title        TEXT NOT NULL,
      content      TEXT,
      type         TEXT DEFAULT 'banner',
      target_roles TEXT DEFAULT 'all',
      is_active    INTEGER DEFAULT 1,
      start_at     DATETIME,
      end_at       DATETIME,
      created_by   TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Seed default system config ──────────────────────────────────────────────
  const defaultConfigs = [
    // General
    ['site_title',                'Bar Council of Uttar Pradesh Certificate Portal', 'string',  'Portal display title',                         'general'],
    ['contact_email',             '',                                                  'string',  'Support contact email',                        'general'],
    ['support_phone',             '',                                                  'string',  'Support phone number',                         'general'],
    // Security
    ['login_max_attempts',        '5',                                                 'number',  'Max failed logins before lockout',             'security'],
    ['login_lock_minutes',        '15',                                                'number',  'Lockout duration in minutes',                  'security'],
    ['otp_expiry_minutes',        '10',                                                'number',  'OTP validity in minutes',                      'security'],
    ['otp_max_attempts',          '3',                                                 'number',  'Max OTP retries before expiry',                'security'],
    ['session_timeout_minutes',   '30',                                                'number',  'Staff/admin session timeout in minutes',       'security'],
    // Features
    ['maintenance_mode',          'false',                                             'boolean', 'Enable site-wide maintenance mode',            'features'],
    ['maintenance_message',       'System under maintenance. Please try again later.','string',  'Message shown during maintenance',             'features'],
    ['certificate_download_enabled','true',                                            'boolean', 'Allow candidates to download certificates',    'features'],
    ['objection_filing_enabled',  'true',                                             'boolean', 'Allow candidates to file objections',          'features'],
    ['allow_new_applications',    'true',                                             'boolean', 'Allow new candidate applications',             'features'],
    ['otp_login_enabled',         'true',                                             'boolean', 'Enable OTP-based candidate login',             'features'],
    // Upload
    ['max_upload_size_mb',        '10',                                                'number',  'Maximum file upload size in MB',               'upload'],
    ['allowed_file_types',        'pdf,jpg,jpeg,png',                                  'string',  'Allowed file extensions (comma-separated)',    'upload'],
    ['bulk_upload_enabled',       'true',                                             'boolean', 'Enable bulk certificate upload',               'upload'],
    // Notifications
    ['sms_enabled',               'false',                                             'boolean', 'Enable SMS notifications',                     'notifications'],
    ['sms_provider',              '',                                                  'string',  'SMS provider (msg91/fast2sms)',                'notifications'],
  ];

  for (const [key, val, type, desc, cat] of defaultConfigs) {
    const [ex] = await pool.query('SELECT id FROM sa_system_config WHERE config_key=?', [key]);
    if (!ex.length) {
      await pool.query(
        'INSERT INTO sa_system_config (config_key,config_value,config_type,description,category) VALUES (?,?,?,?,?)',
        [key, val, type, desc, cat]
      );
    }
  }

  // ── Seed default feature flags ──────────────────────────────────────────────
  const defaultFlags = [
    ['certificate_download',      'Certificate Download',      'Candidate can download verified certificate',      1, 'candidate',                       0, 'candidate', 1],
    ['objection_filing',          'Objection Filing',          'Candidate can file objection/correction request',  1, 'candidate',                       0, 'candidate', 2],
    ['otp_login',                 'OTP Login',                 'Candidate mobile OTP authentication',              1, 'candidate',                       0, 'candidate', 3],
    ['excel_import',              'Excel Import',              'Upload staff can import data via Excel',           1, 'upload_staff,admin',               0, 'staff',     1],
    ['bulk_cert_upload',          'Bulk Certificate Upload',   'Upload staff can bulk-upload certificates',        1, 'upload_staff,admin',               0, 'staff',     2],
    ['single_cert_upload',        'Single Certificate Upload', 'Upload staff can upload individual certificate',   1, 'upload_staff',                    0, 'staff',     3],
    ['objection_raise',           'Raise Objection',          'Objection staff can raise objections',             1, 'objection_staff,admin',            0, 'staff',     4],
    ['objection_resolve',         'Resolve Objection',        'Objection staff can resolve objections',           1, 'objection_staff,admin',            0, 'staff',     5],
    ['staff_management',          'Staff Management',          'Admin can manage staff accounts',                  1, 'admin',                           0, 'admin',     1],
    ['audit_log_view',            'Audit Log View',            'Admin can view audit logs',                        1, 'admin',                           0, 'admin',     2],
    ['data_backup',               'Data Backup',               'Admin can trigger and download backups',           1, 'admin',                           0, 'admin',     3],
    ['application_delete',        'Application Delete',        'Admin can permanently delete applications',        1, 'admin',                           0, 'admin',     4],
    ['beta_analytics',            'Analytics Dashboard',       'Beta analytics and reporting dashboard',           0, 'admin',                           1, 'beta',      1],
    ['beta_api_access',           'API Access Layer',          'External REST API access for integrations',        0, 'admin',                           1, 'beta',      2],
  ];

  for (const [key, label, desc, enabled, roles, is_beta, cat, sort] of defaultFlags) {
    const [ex] = await pool.query('SELECT id FROM sa_feature_flags WHERE feature_key=?', [key]);
    if (!ex.length) {
      await pool.query(
        'INSERT INTO sa_feature_flags (feature_key,label,description,enabled,roles,is_beta,category,sort_order) VALUES (?,?,?,?,?,?,?,?)',
        [key, label, desc, enabled, roles, is_beta, cat, sort]
      );
    }
  }

  // ── Seed default dashboard sections ────────────────────────────────────────
  const defaultSections = [
    // Candidate
    ['status_tracker',    'Status Tracker',         'Application status timeline',          'candidate', 1, 1, 1,  '📋'],
    ['cert_download',     'Certificate Download',   'Download verified certificate',        'candidate', 1, 1, 2,  '📜'],
    ['candidate_notices', 'Notices Board',          'Public notices and announcements',     'candidate', 1, 0, 3,  '📢'],
    ['candidate_objection','File Correction',       'Submit objection/correction request',  'candidate', 1, 0, 4,  '⚠️'],
    // Upload Staff
    ['upload_dashboard',  'Upload Dashboard',       'Certificate upload overview',          'upload_staff', 1, 1, 1, '📊'],
    ['excel_upload',      'Excel Import',           'Bulk data import from Excel',          'upload_staff', 1, 0, 2, '📊'],
    ['cert_upload',       'Certificate Upload',     'Single/bulk cert upload',              'upload_staff', 1, 0, 3, '📤'],
    // Objection Staff
    ['obj_dashboard',     'Objection Dashboard',    'Objection management overview',        'objection_staff', 1, 1, 1, '📊'],
    ['obj_pending',       'Pending Objections',     'Objections awaiting action',           'objection_staff', 1, 0, 2, '⚠️'],
    ['obj_resolved',      'Resolved Objections',    'Closed/resolved objections',           'objection_staff', 1, 0, 3, '✅'],
    // Admin
    ['admin_overview',    'Admin Overview',         'System stats and summary',             'admin', 1, 1, 1, '📊'],
    ['admin_applications','Application Manager',    'Full application CRUD',                'admin', 1, 1, 2, '📋'],
    ['admin_staff',       'Staff Accounts',         'Manage staff users',                   'admin', 1, 0, 3, '👤'],
    ['admin_reports',     'Reports',                'System reports and exports',           'admin', 1, 0, 4, '📈'],
    ['admin_audit',       'Audit Logs',             'System activity logs',                 'admin', 1, 0, 5, '📒'],
    ['admin_backup',      'Backup & Restore',       'Data backup management',               'admin', 1, 0, 6, '💾'],
  ];

  for (const [key, label, desc, roles, enabled, pinned, sort, icon] of defaultSections) {
    const [ex] = await pool.query('SELECT id FROM sa_dashboard_sections WHERE section_key=? AND roles=?', [key, roles]);
    if (!ex.length) {
      await pool.query(
        'INSERT INTO sa_dashboard_sections (section_key,label,description,roles,enabled,pinned,sort_order,icon) VALUES (?,?,?,?,?,?,?,?)',
        [key, label, desc, roles, enabled, pinned, sort, icon]
      );
    }
  }

  // ── Super Admin credentials ─────────────────────────────────────────────────
  const passkeyId = process.env.SUPERADMIN_PASSKEY_ID || 'SAROOT001';
  const password  = 'BarCouncil@2025';
  const hashed    = await bcrypt.hash(password, 12);

  const [existing] = await pool.query('SELECT id FROM super_admins WHERE passkey_id=?', [passkeyId]);
  if (!existing.length) {
    await pool.query(
      'INSERT INTO super_admins (passkey_id, password, full_name) VALUES (?, ?, ?)',
      [passkeyId, hashed, 'Root Super Administrator']
    );
  } else {
    await pool.query('UPDATE super_admins SET password=? WHERE passkey_id=?', [hashed, passkeyId]);
  }

  console.log('✅ Super Admin DB tables ready');
  console.log(`✅ Super Admin ready → Passkey ID: ${passkeyId}`);
  console.log(`✅ Super Admin password: BarCouncil@2025`);
}

module.exports = { initSuperAdminDb };
