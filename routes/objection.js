const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');
const { logAction } = require('../utils/logger');
const { requireNoActiveObjection } = require('../middleware/objectionLock');

const router = express.Router();

// Preserve original extension so browsers display files inline
const objStorage = multer.diskStorage({
  destination: 'uploads/objection_docs/',
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, Date.now() + '_' + Math.random().toString(36).slice(2) + ext);
  }
});
const upload = multer({ storage: objStorage, limits: { fileSize: 10 * 1024 * 1024 } });

// Candidate raises own objection (correction request)
router.post('/', authenticate, requireRole('candidate'), requireNoActiveObjection, async (req, res) => {
  const { reason } = req.body;
  await pool.query(
    "INSERT INTO objections (application_no, reason) VALUES (?, ?)",
    [req.user.application_no, reason]
  );
  res.json({ success: true, message: 'Objection submitted' });
});

// Staff raises a structured objection with required documents list
router.post('/staff-add', authenticate, requireRole('objection_staff', 'admin'), async (req, res) => {
  const { application_no, reason, required_docs } = req.body;
  if (!application_no) return res.status(400).json({ success: false, message: 'Missing application_no' });

  // Verify application exists
  const [apps] = await pool.query("SELECT id FROM applications WHERE application_no=?", [application_no]);
  if (!apps.length) return res.status(404).json({ success: false, message: 'Application not found' });

  const docsJson = required_docs ? JSON.stringify(required_docs) : null;
  const objReason = reason || (required_docs ? required_docs.join(', ') : 'Documents required');

  await pool.query(
    "INSERT INTO objections (application_no, reason, required_docs, status) VALUES (?, ?, ?, 'open')",
    [application_no, objReason, docsJson]
  );
  await pool.query("UPDATE applications SET status='objection' WHERE application_no=?", [application_no]);
  await logAction(req.user.id, req.user.role, 'STAFF_OBJECTION', `Raised objection for ${application_no}`, req.ip);
  res.json({ success: true, message: 'Objection raised' });
});

// Candidate clears objection by uploading documents
router.post('/clear/:id', authenticate, requireRole('candidate'), upload.array('files', 10), async (req, res) => {
  const objId = req.params.id;

  // Confirm this objection belongs to this candidate
  const [rows] = await pool.query(
    "SELECT * FROM objections WHERE id=? AND application_no=? AND status IN ('open','rejected','objection_pending','objection_reupload_required')",
    [objId, req.user.application_no]
  );
  if (!rows.length) return res.status(404).json({ success: false, message: 'Objection not found or already cleared' });

  if (!req.files || !req.files.length) {
    return res.status(400).json({ success: false, message: 'Please upload required document files' });
  }

  const filePaths = req.files.map(f => f.filename);
  await pool.query(
    "UPDATE objections SET status='under_review', cleared_files=? WHERE id=?",
    [JSON.stringify(filePaths), objId]
  );
  await logAction(req.user.application_no, 'candidate', 'CLEAR_OBJECTION', `Uploaded docs for objection ${objId}`, req.ip);
  res.json({ success: true, message: 'Documents submitted. Under review.' });
});

// Get objections (objection staff & admin)
router.get('/', authenticate, requireRole('objection_staff', 'admin'), async (req, res) => {
  const status = req.query.status || 'open';
  let query, params;
  if (status === 'all') {
    query = "SELECT o.*, a.name, a.father_name, a.district, a.mobile FROM objections o LEFT JOIN applications a ON o.application_no=a.application_no ORDER BY o.id DESC";
    params = [];
  } else {
    query = "SELECT o.*, a.name, a.father_name, a.district, a.mobile FROM objections o LEFT JOIN applications a ON o.application_no=a.application_no WHERE o.status=? ORDER BY o.id DESC";
    params = [status];
  }
  const [rows] = await pool.query(query, params);
  res.json({ success: true, data: rows });
});

// Resolve objection
router.post('/resolve', authenticate, requireRole('objection_staff', 'admin'), async (req, res) => {
  const { id, decision, remarks } = req.body;
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ success: false, message: 'Invalid decision' });
  const [rows] = await pool.query("SELECT application_no FROM objections WHERE id=?", [id]);
  await pool.query(
    "UPDATE objections SET status=?, remarks=?, handled_by=?, resolved_at=CURRENT_TIMESTAMP WHERE id=?",
    [decision, remarks, req.user.id, id]
  );
  if (rows.length) {
    await pool.query(
      "UPDATE applications SET status=? WHERE application_no=? AND status='objection'",
      [decision === 'approved' ? 'pending' : 'objection', rows[0].application_no]
    );
  }
  await logAction(req.user.id, req.user.role, 'RESOLVE_OBJECTION', `Objection ${id} → ${decision}`, req.ip);
  res.json({ success: true });
});

// Get list of submitted files for an objection (staff/admin)
router.get('/:id/files', authenticate, requireRole('objection_staff', 'admin'), async (req, res) => {
  const [rows] = await pool.query("SELECT application_no, cleared_files FROM objections WHERE id=?", [req.params.id]);
  if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
  let files = [];
  try { files = JSON.parse(rows[0].cleared_files || '[]'); } catch(e) {}
  res.json({ success: true, application_no: rows[0].application_no, files });
});

// Download all submitted files as ZIP named after application_no
router.get('/:id/download-zip', authenticate, requireRole('objection_staff', 'admin'), async (req, res) => {
  const [rows] = await pool.query("SELECT application_no, cleared_files FROM objections WHERE id=?", [req.params.id]);
  if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });

  let files = [];
  try { files = JSON.parse(rows[0].cleared_files || '[]'); } catch(e) {}
  if (!files.length) return res.status(400).json({ success: false, message: 'No files to download' });

  const appNo = rows[0].application_no.replace(/\//g, '_'); // UP50501_25
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${appNo}_documents.zip"`);

  const zip = archiver('zip', { zlib: { level: 9 } });
  zip.on('error', err => res.status(500).end());
  zip.pipe(res);

  for (const filename of files) {
    const filePath = path.join(__dirname, '..', 'uploads', 'objection_docs', filename);
    if (fs.existsSync(filePath)) {
      // Detect extension and give a friendly name
      const ext = path.extname(filename);
      const docIndex = files.indexOf(filename) + 1;
      zip.file(filePath, { name: `${appNo}_doc${docIndex}${ext}` });
    }
  }

  zip.finalize();
});

module.exports = router;