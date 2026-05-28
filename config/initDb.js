const bcrypt = require('bcryptjs');

async function initDatabase() {
  const pool = require('./db');

  // Users table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT,
      role TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Applications table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_no TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      father_name TEXT,
      district TEXT,
      mobile TEXT,
      status TEXT DEFAULT 'pending',
      upload_enabled INTEGER DEFAULT 1,
      final_chance INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Certificates
  await pool.query(`
    CREATE TABLE IF NOT EXISTS certificates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_no TEXT NOT NULL,
      file_path TEXT NOT NULL,
      uploaded_by INTEGER,
      status TEXT DEFAULT 'pending',
      remarks TEXT,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Uploads (excel batches)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT,
      uploaded_by INTEGER,
      total_rows INTEGER DEFAULT 0,
      inserted_rows INTEGER DEFAULT 0,
      error_rows INTEGER DEFAULT 0,
      skipped_rows INTEGER DEFAULT 0,
      error_log TEXT,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Objections
  await pool.query(`
    CREATE TABLE IF NOT EXISTS objections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_no TEXT NOT NULL,
      reason TEXT,
      required_docs TEXT,
      cleared_files TEXT,
      status TEXT DEFAULT 'open',
      remarks TEXT,
      handled_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME NULL
    )
  `);

  // Migrations for existing objections table
  try { await pool.query("ALTER TABLE objections ADD COLUMN required_docs TEXT"); } catch(e) {}
  try { await pool.query("ALTER TABLE objections ADD COLUMN cleared_files TEXT"); } catch(e) {}

  // Duplicate requests
  await pool.query(`
    CREATE TABLE IF NOT EXISTS duplicate_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_no TEXT NOT NULL,
      candidate_user_id INTEGER,
      reason TEXT,
      payment_mode TEXT,
      txn_id TEXT,
      payment_status TEXT DEFAULT 'pending_verification',
      photo_path TEXT,
      document_validation_status TEXT DEFAULT 'pending',
      status TEXT DEFAULT 'pending',
      idempotency_key TEXT,
      trace_id TEXT,
      admin_remarks TEXT,
      rejection_reason TEXT,
      approved_by INTEGER,
      approved_at DATETIME,
      delivered_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try { await pool.query("ALTER TABLE duplicate_requests ADD COLUMN candidate_user_id INTEGER"); } catch(e) {}
  try { await pool.query("ALTER TABLE duplicate_requests ADD COLUMN payment_mode TEXT"); } catch(e) {}
  try { await pool.query("ALTER TABLE duplicate_requests ADD COLUMN txn_id TEXT"); } catch(e) {}
  try { await pool.query("ALTER TABLE duplicate_requests ADD COLUMN payment_status TEXT DEFAULT 'pending_verification'"); } catch(e) {}
  try { await pool.query("ALTER TABLE duplicate_requests ADD COLUMN photo_path TEXT"); } catch(e) {}
  try { await pool.query("ALTER TABLE duplicate_requests ADD COLUMN document_validation_status TEXT DEFAULT 'pending'"); } catch(e) {}
  try { await pool.query("ALTER TABLE duplicate_requests ADD COLUMN idempotency_key TEXT"); } catch(e) {}
  try { await pool.query("ALTER TABLE duplicate_requests ADD COLUMN trace_id TEXT"); } catch(e) {}
  try { await pool.query("ALTER TABLE duplicate_requests ADD COLUMN admin_remarks TEXT"); } catch(e) {}
  try { await pool.query("ALTER TABLE duplicate_requests ADD COLUMN rejection_reason TEXT"); } catch(e) {}

  await pool.query(`CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS duplicate_request_timeline (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    duplicate_request_id INTEGER NOT NULL,
    actor_id INTEGER,
    actor_role TEXT,
    event_type TEXT NOT NULL,
    details TEXT,
    trace_id TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS certificate_generation_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    duplicate_request_id INTEGER NOT NULL,
    status TEXT DEFAULT 'queued',
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    last_error TEXT,
    next_retry_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_duplicate_txn_id_unique ON duplicate_requests(txn_id)');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_duplicate_idem_unique ON duplicate_requests(idempotency_key)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_duplicate_status ON duplicate_requests(status)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_queue_status_retry ON certificate_generation_queue(status, next_retry_at)');

  await pool.query(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    application_no TEXT,
    type TEXT,
    title TEXT,
    message TEXT,
    metadata TEXT,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_no TEXT UNIQUE,
    full_name TEXT NOT NULL,
    mobile TEXT NOT NULL,
    email TEXT,
    state TEXT,
    enrollment_no TEXT,
    identity_no TEXT,
    address TEXT,
    photo_path TEXT,
    document_path TEXT,
    otp_verified INTEGER DEFAULT 0,
    captcha_verified INTEGER DEFAULT 0,
    terms_accepted INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    remarks TEXT,
    trace_id TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  const cfgDefaults = [
    ['registration_enabled', '0'], ['registration_mode', 'admin_upload_only'], ['registration_visibility', 'hidden'],
    ['registration_requires_approval', '1'], ['invite_only_mode', '0'], ['registration_window_active', '0'],
    ['registration_daily_limit', '100'], ['dynamic_registration_fields', '[]']
  ];
  for (const [key, value] of cfgDefaults) {
    await pool.query('INSERT OR IGNORE INTO system_config(key, value) VALUES(?, ?)', [key, value]);
  }


  await pool.query(`CREATE TABLE IF NOT EXISTS monitoring_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    metric_type TEXT NOT NULL,
    status TEXT NOT NULL,
    details TEXT,
    trace_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS async_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    queue_name TEXT NOT NULL,
    trace_id TEXT,
    dedup_key TEXT,
    payload TEXT,
    status TEXT DEFAULT 'queued',
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 5,
    run_after DATETIME,
    last_error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_async_jobs_status ON async_jobs(status, run_after)');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_async_jobs_dedup ON async_jobs(dedup_key, status)');
  try { await pool.query("ALTER TABLE async_jobs ADD COLUMN progress INTEGER DEFAULT 0"); } catch (e) {}
  try { await pool.query("ALTER TABLE async_jobs ADD COLUMN worker_name TEXT"); } catch (e) {}
  try { await pool.query("ALTER TABLE async_jobs ADD COLUMN started_at DATETIME"); } catch (e) {}
  try { await pool.query("ALTER TABLE async_jobs ADD COLUMN completed_at DATETIME"); } catch (e) {}
  try { await pool.query("ALTER TABLE async_jobs ADD COLUMN latency_ms INTEGER DEFAULT 0"); } catch (e) {}

  await pool.query(`CREATE TABLE IF NOT EXISTS queue_retry_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    async_job_id INTEGER,
    trace_id TEXT,
    queue_name TEXT,
    retry_no INTEGER,
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS queue_worker_health (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_name TEXT,
    status TEXT,
    details TEXT,
    trace_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS scan_quarantine (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_path TEXT,
    quarantine_path TEXT,
    status TEXT DEFAULT 'quarantined',
    reason TEXT,
    trace_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS audit_log_chain (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    actor_id INTEGER,
    actor_role TEXT,
    trace_id TEXT,
    ip_address TEXT,
    user_agent TEXT,
    payload TEXT,
    event_version INTEGER DEFAULT 1,
    prev_hash TEXT,
    event_hash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);


  await pool.query(`CREATE TABLE IF NOT EXISTS certificate_verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    certificate_id TEXT UNIQUE NOT NULL,
    application_no TEXT NOT NULL,
    certificate_hash TEXT NOT NULL,
    verification_signature TEXT NOT NULL,
    verification_url TEXT NOT NULL,
    immutable_record_hash TEXT,
    status TEXT DEFAULT 'active',
    issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    verified_at DATETIME
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_cert_verify_app ON certificate_verifications(application_no)');

  await pool.query(`CREATE TABLE IF NOT EXISTS verification_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    certificate_id TEXT,
    action TEXT NOT NULL,
    trace_id TEXT,
    ip_address TEXT,
    user_agent TEXT,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  
  await pool.query(`CREATE TABLE IF NOT EXISTS malware_scan_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    certificate_id INTEGER,
    file_path TEXT,
    status TEXT,
    verdict TEXT,
    infected INTEGER DEFAULT 0,
    retry_attempt INTEGER DEFAULT 0,
    duration_ms INTEGER DEFAULT 0,
    trace_id TEXT,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  try { await pool.query("ALTER TABLE certificates ADD COLUMN security_status TEXT DEFAULT 'pending_scan'"); } catch(e) {}
  try { await pool.query("ALTER TABLE certificates ADD COLUMN quarantined_at DATETIME"); } catch(e) {}
  try { await pool.query("ALTER TABLE certificates ADD COLUMN scan_trace_id TEXT"); } catch(e) {}

  await pool.query(`CREATE TABLE IF NOT EXISTS storage_objects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    bucket_type TEXT DEFAULT 'private',
    object_key TEXT NOT NULL,
    local_path TEXT,
    checksum_sha256 TEXT,
    size_bytes INTEGER,
    retention_until DATETIME,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  // OTP codes
  await pool.query(`
    CREATE TABLE IF NOT EXISTS otp_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_no TEXT NOT NULL,
      otp TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Action logs
  await pool.query(`
    CREATE TABLE IF NOT EXISTS action_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      role TEXT,
      action TEXT,
      details TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Backup logs
  await pool.query(`
    CREATE TABLE IF NOT EXISTS backup_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT,
      size_kb INTEGER,
      type TEXT DEFAULT 'manual',
      status TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Notices
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT,
      file_path TEXT,
      target_audience TEXT DEFAULT 'public',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Run a migration to add file_path if it doesn't exist (since DB is already created)
  try {
    await pool.query("ALTER TABLE notices ADD COLUMN file_path TEXT");
  } catch (err) {}
  
  try {
    await pool.query("ALTER TABLE notices ADD COLUMN target_audience TEXT DEFAULT 'public'");
  } catch (err) {}

  // Seed default admin
  const [admins] = await pool.query("SELECT id FROM users WHERE role='admin' LIMIT 1");
  if (admins.length === 0) {
    const hashed = await bcrypt.hash('admin123', 10);
    await pool.query(
      "INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)",
      ['admin', hashed, 'System Administrator', 'admin']
    );
    console.log('✅ Default admin created → username: admin, password: admin123');
  }

  // Seed default staff
  const [uploadStaff] = await pool.query("SELECT id FROM users WHERE username='staff' LIMIT 1");
  if (uploadStaff.length === 0) {
    const hashed = await bcrypt.hash('staff123', 10);
    await pool.query(
      "INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)",
      ['staff', hashed, 'Upload Staff', 'upload_staff']
    );
    console.log('✅ Default upload staff created → username: staff, password: staff123');
  }

  const [objectionStaff] = await pool.query("SELECT id FROM users WHERE username='objection_staff' LIMIT 1");
  if (objectionStaff.length === 0) {
    const hashed = await bcrypt.hash('staff123', 10);
    await pool.query(
      "INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)",
      ['objection_staff', hashed, 'Objection Staff', 'objection_staff']
    );
    console.log('✅ Default objection staff created → username: objection_staff, password: staff123');
  }

  // Notices are not seeded automatically; office notices must be created by authorized users.


  console.log('✅ Database initialized successfully using SQLite');
}

module.exports = { initDatabase };
