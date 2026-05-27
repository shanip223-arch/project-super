const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');
const { requireNoActiveObjection } = require('../middleware/objectionLock');
const { AppError, asyncHandler } = require('../middleware/errors');
const { sanitizeText, safeUnlink, validateUploadedJpeg, toPrivateUploadPath, makeNotification } = require('../utils/duplicateCertificate');
const rateLimit = require('express-rate-limit');

const router = express.Router();


const duplicatePhotoStorage = multer.diskStorage({
  destination: 'uploads/temp/',
  filename: (req, file, cb) => {
    const unique = Date.now() + '_' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});

const duplicatePhotoUpload = multer({
  storage: duplicatePhotoStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!['image/jpeg', 'image/jpg'].includes(file.mimetype)) {
      return cb(new AppError(400, 'INVALID_IMAGE', 'Only JPG/JPEG allowed.'));
    }
    cb(null, true);
  }
});

const duplicateApplyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ success: false, error_code: 'RATE_LIMITED', message: 'Too many requests.', trace_id: req.traceId })
});

const logTimeline = async ({ duplicateRequestId, req, eventType, details, actorId, actorRole }) => {
  await pool.query(
    `INSERT INTO duplicate_request_timeline (duplicate_request_id, actor_id, actor_role, event_type, details, trace_id, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [duplicateRequestId, actorId || null, actorRole || 'candidate', eventType, details || '', req.traceId, req.ip, req.headers['user-agent'] || 'unknown']
  );
};

// Candidate's own info + status
router.get('/me', authenticate, requireRole('candidate'), async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM applications WHERE application_no=?", [req.user.application_no]);
  if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
  const [certs] = await pool.query("SELECT * FROM certificates WHERE application_no=? ORDER BY id DESC", [req.user.application_no]);
  const [objs] = await pool.query("SELECT * FROM objections WHERE application_no=? ORDER BY id DESC", [req.user.application_no]);
  res.json({ success: true, data: rows[0], certificates: certs, objections: objs });
});

// Download certificate
router.get('/certificate/download', authenticate, requireRole('candidate'), requireNoActiveObjection, async (req, res) => {
  const [certs] = await pool.query(
    "SELECT * FROM certificates WHERE application_no=? AND status='verified' ORDER BY id DESC LIMIT 1",
    [req.user.application_no]
  );
  if (!certs.length) return res.status(404).json({ success: false, message: 'No certificate available' });
  const filePath = path.resolve(certs[0].file_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, message: 'File missing' });
  res.download(filePath);
});


// Duplicate certificate application
router.post('/duplicate-apply', authenticate, requireRole('candidate'), duplicateApplyLimiter, duplicatePhotoUpload.single('photo'), asyncHandler(async (req, res) => {
    const application_no = sanitizeText(req.body.application_no, 40);
    const reason = sanitizeText(req.body.reason, 1000);
    const payment_mode = sanitizeText(req.body.payment_mode, 20);
    const txn_id = sanitizeText(req.body.txn_id, 80);
    const idempotencyKey = sanitizeText(req.headers['idempotency-key'] || '', 80) || null;

    if (!application_no || !reason || !payment_mode || !txn_id || !req.file) throw new AppError(400, 'VALIDATION_ERROR', 'Missing required fields.');
    if (req.user.application_no !== application_no) throw new AppError(403, 'CROSS_USER_ACCESS_DENIED', 'Application access denied.');
    if (!['upi', 'bank_transfer', 'cash', 'card'].includes(payment_mode)) throw new AppError(400, 'INVALID_PAYMENT_MODE', 'Unsupported payment mode.');
    if (!/^[A-Za-z0-9_-]{6,40}$/.test(txn_id)) throw new AppError(400, 'INVALID_TXN_ID', 'Invalid transaction id format.');

    validateUploadedJpeg(req.file);

    await pool.query('BEGIN IMMEDIATE TRANSACTION');
    try {
      const [apps] = await pool.query('SELECT application_no, status FROM applications WHERE application_no=?', [application_no]);
      if (!apps.length) throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Application not found.');
      if (String(apps[0].status).toLowerCase() === 'blocked') throw new AppError(403, 'CANDIDATE_BLOCKED', 'Candidate is blocked.');
      const [certs] = await pool.query('SELECT id FROM certificates WHERE application_no=? LIMIT 1', [application_no]);
      if (!certs.length) throw new AppError(400, 'CERTIFICATE_NOT_FOUND', 'Certificate not found for this application.');

      const [pending] = await pool.query(`SELECT id FROM duplicate_requests WHERE application_no=? AND status IN ('pending','under_review','approved','certificate_generated')`, [application_no]);
      if (pending.length) throw new AppError(409, 'DUPLICATE_PENDING', 'A duplicate request is already in progress.');
      const [existingTxn] = await pool.query(`SELECT id FROM duplicate_requests WHERE txn_id=? LIMIT 1`, [txn_id]);
      if (existingTxn.length) throw new AppError(409, 'DUPLICATE_TXN', 'Transaction already used.');
      if (idempotencyKey) {
        const [idem] = await pool.query('SELECT id FROM duplicate_requests WHERE idempotency_key=? LIMIT 1', [idempotencyKey]);
        if (idem.length) {
          await pool.query('COMMIT');
          safeUnlink(req.file.path);
          return res.status(200).json({ success: true, message: 'Duplicate request already accepted.', request_id: idem[0].id, trace_id: req.traceId });
        }
      }

      const privatePhotoPath = toPrivateUploadPath(req.file.path, application_no);
      const [r] = await pool.query(
        `INSERT INTO duplicate_requests (application_no, candidate_user_id, reason, payment_mode, txn_id, payment_status, photo_path, status, idempotency_key, trace_id)
         VALUES (?, ?, ?, ?, ?, 'pending_verification', ?, 'pending', ?, ?)`,
        [application_no, req.user.id || null, reason, payment_mode, txn_id, privatePhotoPath, idempotencyKey, req.traceId]
      );
      await pool.query(`INSERT INTO certificate_generation_queue (duplicate_request_id, status) VALUES (?, 'queued')`, [r.insertId]);
      await pool.query('INSERT INTO notifications (application_no, type, title, message, metadata) VALUES (?, ?, ?, ?, ?)', makeNotification({ application_no, type: 'duplicate_submitted', title: 'Duplicate request submitted', message: 'Your request is pending validation.', metadata: { request_id: r.insertId } }));
      await logTimeline({ duplicateRequestId: r.insertId, req, eventType: 'request_created', details: `Payment mode=${payment_mode}`, actorId: req.user.id, actorRole: req.user.role });
      await pool.query('COMMIT');
      res.json({ success: true, message: 'Duplicate application submitted successfully.', request_id: r.insertId, trace_id: req.traceId });
    } catch (e) {
      await pool.query('ROLLBACK');
      safeUnlink(req.file && req.file.path);
      throw e;
    }
}));

// Public notices
router.get('/notices', async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM notices WHERE is_active=1 AND target_audience='public' ORDER BY id DESC LIMIT 20");
    res.json({ success: true, data: rows });
  } catch(e) {
    // Fallback if migration hasn't run yet
    const [rows] = await pool.query("SELECT * FROM notices WHERE is_active=1 ORDER BY id DESC LIMIT 20");
    res.json({ success: true, data: rows });
  }
});

router.get('/duplicate-requests', authenticate, requireRole('candidate'), asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM duplicate_requests WHERE application_no=? ORDER BY id DESC', [req.user.application_no]);
  res.json({ success: true, data: rows, trace_id: req.traceId });
}));

router.get('/duplicate-requests/:id/timeline', authenticate, requireRole('candidate'), asyncHandler(async (req, res) => {
  const [reqRows] = await pool.query('SELECT id FROM duplicate_requests WHERE id=? AND application_no=?', [req.params.id, req.user.application_no]);
  if (!reqRows.length) throw new AppError(404, 'REQUEST_NOT_FOUND', 'Request not found.');
  const [rows] = await pool.query('SELECT event_type, details, created_at FROM duplicate_request_timeline WHERE duplicate_request_id=? ORDER BY id ASC', [req.params.id]);
  res.json({ success: true, data: rows, trace_id: req.traceId });
}));

module.exports = router;
