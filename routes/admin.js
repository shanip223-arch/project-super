const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');
const { parseExcel, validateApplicationNo } = require('../utils/excelParser');
const { runBackup } = require('../utils/backup');
const { logAction } = require('../utils/logger');

const router = express.Router();

const upload = multer({
  dest: 'uploads/temp/',
  limits: { fileSize: 25 * 1024 * 1024 }
});

// Dashboard stats are calculated only from saved database records.
router.get('/dashboard', authenticate, requireRole('admin'), async (req, res) => {
  const [[apps]] = await pool.query("SELECT COUNT(*) AS total FROM applications");
  const [[pending]] = await pool.query("SELECT COUNT(*) AS total FROM applications WHERE LOWER(status)='pending'");
  const [[verification]] = await pool.query("SELECT COUNT(*) AS total FROM applications WHERE LOWER(status)='verification'");
  const [[approved]] = await pool.query("SELECT COUNT(*) AS total FROM applications WHERE LOWER(status)='approved'");
  const [[certs]] = await pool.query("SELECT COUNT(*) AS total FROM certificates");
  const [[obj]] = await pool.query("SELECT COUNT(*) AS total FROM objections WHERE LOWER(status)='open'");
  const [[staff]] = await pool.query("SELECT COUNT(*) AS total FROM users WHERE role IN ('admin','upload_staff','objection_staff')");
  res.json({ success: true, stats: { applications: apps.total, pending: pending.total, verification: verification.total, approved: approved.total, certificates: certs.total, objections: obj.total, staff: staff.total } });
});

// Step 1: Upload excel and return columns
router.post('/excel-upload/preview', authenticate, requireRole('admin'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const { columns, rows } = parseExcel(req.file.path);
    res.json({ success: true, columns, previewRows: rows.slice(0, 5), tempFile: req.file.filename, totalRows: rows.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Step 2: Confirm mapping & insert
router.post('/excel-upload/confirm', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { tempFile, mapping } = req.body;
    // mapping = { application_no: "Col1", name: "Col2", father_name: "Col3", district: "Col4", mobile: "Col5" }
    const filePath = path.join('uploads/temp', tempFile);
    if (!fs.existsSync(filePath)) return res.status(400).json({ success: false, message: 'Temp file missing' });

    const { rows } = parseExcel(filePath);
    let inserted = 0, errors = 0, skipped = 0;
    const errorLog = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const application_no = String(r[mapping.application_no] || '').trim();
      const name = String(r[mapping.name] || '').trim();
      const father_name = String(r[mapping.father_name] || '').trim();
      const district = String(r[mapping.district] || '').trim();
      const mobile = String(r[mapping.mobile] || '').trim();

      if (!application_no || !name) { errors++; errorLog.push(`Row ${i+2}: missing application_no or name`); continue; }
      if (!validateApplicationNo(application_no)) { errors++; errorLog.push(`Row ${i+2}: invalid application_no format → ${application_no}`); continue; }

      try {
        await pool.query(
          "INSERT INTO applications (application_no, name, father_name, district, mobile) VALUES (?, ?, ?, ?, ?)",
          [application_no, name, father_name, district, mobile]
        );
        inserted++;
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') { skipped++; errorLog.push(`Row ${i+2}: duplicate ${application_no}`); }
        else { errors++; errorLog.push(`Row ${i+2}: ${err.message}`); }
      }
    }

    await pool.query(
      "INSERT INTO uploads (filename, uploaded_by, total_rows, inserted_rows, error_rows, skipped_rows, error_log) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [tempFile, req.user.id, rows.length, inserted, errors, skipped, errorLog.join('\n')]
    );

    fs.unlinkSync(filePath);
    await logAction(req.user.id, 'admin', 'EXCEL_UPLOAD', `Inserted ${inserted}, errors ${errors}, skipped ${skipped}`, req.ip);
    res.json({ success: true, inserted, errors, skipped, errorLog });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// List applications with server-side pagination and filtering.
router.get('/applications', authenticate, requireRole('admin'), async (req, res) => {
  const search = String(req.query.search || '').trim();
  const status = String(req.query.status || '').trim().toLowerCase();
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
  const offset = (page - 1) * limit;
  const sortMap = {
    id: 'id',
    application_no: 'application_no',
    name: 'name',
    district: 'district',
    status: 'status',
    created_at: 'created_at',
    updated_at: 'updated_at'
  };
  const sort = sortMap[req.query.sort] || 'id';
  const dir = String(req.query.dir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const where = [];
  const params = [];

  if (search) {
    where.push('(application_no LIKE ? OR name LIKE ? OR father_name LIKE ? OR district LIKE ? OR mobile LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) {
    where.push('LOWER(status)=?');
    params.push(status);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM applications ${whereSql}`, params);
  const total = countRows[0]?.total || 0;
  const [rows] = await pool.query(
    `SELECT id, application_no, name, father_name, district, mobile, status, upload_enabled, final_chance, created_at, updated_at FROM applications ${whereSql} ORDER BY ${sort} ${dir} LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ success: true, data: rows, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } });
});

// Get single database application and its saved related records.
router.get('/applications/:id', authenticate, requireRole('admin'), async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM applications WHERE id=?", [req.params.id]);
  if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
  const [certs] = await pool.query("SELECT * FROM certificates WHERE application_no=? ORDER BY id DESC", [rows[0].application_no]);
  const [objections] = await pool.query("SELECT * FROM objections WHERE application_no=? ORDER BY id DESC", [rows[0].application_no]);
  res.json({ success: true, data: rows[0], certificates: certs, objections });
});

router.post('/applications/:id/workflow', authenticate, requireRole('admin'), async (req, res) => {
  const action = String(req.body.action || '').toLowerCase();
  const statusByAction = { verify: 'verification', approve: 'approved', reject: 'rejected', objection: 'objection', assign: null, view: null };
  if (!Object.prototype.hasOwnProperty.call(statusByAction, action)) return res.status(400).json({ success: false, message: 'Invalid workflow action' });
  const [rows] = await pool.query("SELECT id, application_no FROM applications WHERE id=?", [req.params.id]);
  if (!rows.length) return res.status(404).json({ success: false, message: 'Application not found' });
  const applicationNo = rows[0].application_no;

  if (statusByAction[action]) {
    await pool.query("UPDATE applications SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", [statusByAction[action], req.params.id]);
  }
  if (action === 'objection') {
    const reason = String(req.body.reason || '').trim();
    await pool.query("INSERT INTO objections (application_no, reason, status, handled_by) VALUES (?, ?, 'open', ?)", [applicationNo, reason, req.user.id]);
  }
  await logAction(req.user.id, 'admin', action.toUpperCase(), `Application ${applicationNo}`, req.ip);
  res.json({ success: true });
});

// Edit
router.put('/edit/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { name, father_name, district, mobile, status } = req.body;
  await pool.query(
    "UPDATE applications SET name=?, father_name=?, district=?, mobile=?, status=? WHERE id=?",
    [name, father_name, district, mobile, status, req.params.id]
  );
  await logAction(req.user.id, 'admin', 'EDIT_APPLICATION', `Updated app id ${req.params.id}`, req.ip);
  res.json({ success: true });
});

// Delete
router.delete('/delete/:id', authenticate, requireRole('admin'), async (req, res) => {
  await pool.query("DELETE FROM applications WHERE id=?", [req.params.id]);
  await logAction(req.user.id, 'admin', 'DELETE_APPLICATION', `Deleted app id ${req.params.id}`, req.ip);
  res.json({ success: true });
});

// Override upload (enable/disable + final chance)
router.post('/override-upload', authenticate, requireRole('admin'), async (req, res) => {
  const { application_no, upload_enabled, final_chance } = req.body;
  await pool.query(
    "UPDATE applications SET upload_enabled=?, final_chance=? WHERE application_no=?",
    [upload_enabled ? 1 : 0, final_chance ? 1 : 0, application_no]
  );
  await logAction(req.user.id, 'admin', 'OVERRIDE_UPLOAD', `App ${application_no} enabled=${upload_enabled} final=${final_chance}`, req.ip);
  res.json({ success: true });
});

// Staff management
router.get('/staff', authenticate, requireRole('admin'), async (req, res) => {
  const [rows] = await pool.query("SELECT id, username, full_name, role, is_active, created_at FROM users WHERE role IN ('admin','upload_staff','objection_staff') ORDER BY id DESC");
  res.json({ success: true, data: rows });
});

router.post('/staff', authenticate, requireRole('admin'), async (req, res) => {
  const { username, password, full_name, role } = req.body;
  if (!['upload_staff', 'objection_staff'].includes(role)) return res.status(400).json({ success: false, message: 'Invalid role' });
  const hashed = await bcrypt.hash(password, 10);
  await pool.query(
    "INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)",
    [username, hashed, full_name, role]
  );
  await logAction(req.user.id, 'admin', 'CREATE_STAFF', `Created ${username} as ${role}`, req.ip);
  res.json({ success: true });
});

router.put('/staff/:id/toggle', authenticate, requireRole('admin'), async (req, res) => {
  await pool.query("UPDATE users SET is_active = 1 - is_active WHERE id=? AND role IN ('upload_staff','objection_staff')", [req.params.id]);
  await logAction(req.user.id, 'admin', 'TOGGLE_STAFF', `Toggled staff id ${req.params.id}`, req.ip);
  res.json({ success: true });
});

router.delete('/staff/:id', authenticate, requireRole('admin'), async (req, res) => {
  await pool.query("DELETE FROM users WHERE id=? AND role IN ('upload_staff','objection_staff')", [req.params.id]);
  res.json({ success: true });
});

// Activity logs
router.get('/logs', authenticate, requireRole('admin', 'upload_staff', 'objection_staff'), async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM action_logs ORDER BY id DESC LIMIT 200");
  res.json({ success: true, data: rows });
});

router.get('/audit-logs', authenticate, requireRole('admin'), async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM action_logs ORDER BY id DESC LIMIT 200");
  res.json({ success: true, data: rows });
});

// Notices CRUD
router.get('/notices', authenticate, requireRole('admin', 'upload_staff', 'objection_staff'), async (req, res) => {
  let query = "SELECT * FROM notices ORDER BY id DESC";
  if (req.user.role !== 'admin') {
    query = "SELECT * FROM notices WHERE target_audience='staff' ORDER BY id DESC";
  }
  const [rows] = await pool.query(query);
  res.json({ success: true, data: rows });
});

router.post('/notices', authenticate, requireRole('admin'), upload.single('file'), async (req, res) => {
  const { title, content, target_audience } = req.body;
  const filePath = req.file ? req.file.filename : null;
  const target = target_audience || 'public';
  await pool.query("INSERT INTO notices (title, content, file_path, target_audience) VALUES (?, ?, ?, ?)", [title, content, filePath, target]);
  res.json({ success: true });
});

router.delete('/notices/:id', authenticate, requireRole('admin'), async (req, res) => {
  await pool.query("DELETE FROM notices WHERE id=?", [req.params.id]);
  res.json({ success: true });
});

// Manual backup
router.post('/backup', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const result = await runBackup('manual');
    await logAction(req.user.id, 'admin', 'BACKUP', `Manual backup ${result.filename}`, req.ip);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/backups', authenticate, requireRole('admin'), async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM backup_logs ORDER BY id DESC LIMIT 50");
  res.json({ success: true, data: rows });
});

// Uploads list (excel batches)
router.get('/uploads', authenticate, requireRole('admin', 'upload_staff', 'objection_staff'), async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM uploads ORDER BY id DESC LIMIT 100");
  res.json({ success: true, data: rows });
});

router.get('/duplicate-requests', authenticate, requireRole('admin','upload_staff','objection_staff'), async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM duplicate_requests ORDER BY id DESC LIMIT 300');
  res.json({ success: true, data: rows });
});

router.post('/duplicate-requests/:id/review', authenticate, requireRole('admin'), async (req, res) => {
  const { status, remarks, rejection_reason } = req.body;
  if (!['under_review','approved','rejected','certificate_generated','delivered'].includes(status)) return res.status(400).json({ success: false, message: 'Invalid status' });
  await pool.query('UPDATE duplicate_requests SET status=?, admin_remarks=?, rejection_reason=?, approved_by=?, approved_at=CASE WHEN ?="approved" THEN CURRENT_TIMESTAMP ELSE approved_at END WHERE id=?', [status, remarks || null, rejection_reason || null, req.user.id, status, req.params.id]);
  await pool.query('INSERT INTO duplicate_request_timeline (duplicate_request_id, actor_id, actor_role, event_type, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.params.id, req.user.id, req.user.role, 'admin_review', `${status}:${remarks || ''}`, req.ip, req.headers['user-agent'] || 'unknown']);
  res.json({ success: true });
});

router.get('/registrations', authenticate, requireRole('admin','upload_staff','objection_staff'), async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM registrations ORDER BY id DESC LIMIT 300');
  res.json({ success: true, data: rows });
});

router.post('/registrations/:id/review', authenticate, requireRole('admin','upload_staff','objection_staff'), async (req, res) => {
  const { status, remarks } = req.body;
  if (!['approved','rejected','correction_required','pending'].includes(status)) return res.status(400).json({ success: false, message: 'Invalid status' });
  const [rows] = await pool.query('SELECT * FROM registrations WHERE id=?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
  await pool.query('UPDATE registrations SET status=?, remarks=? WHERE id=?', [status, remarks || null, req.params.id]);
  if (status === 'approved') {
    await pool.query('INSERT OR IGNORE INTO applications (application_no, name, district, mobile, status) VALUES (?, ?, ?, ?, ?)', [rows[0].application_no, rows[0].full_name, rows[0].state || '', rows[0].mobile, 'pending']);
  }
  res.json({ success: true });
});

module.exports = router;
