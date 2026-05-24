const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');
const { requireNoActiveObjection } = require('../middleware/objectionLock');

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
      return cb(new Error('Only JPG/JPEG photo is allowed.'));
    }
    cb(null, true);
  }
});

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
router.post('/duplicate-apply', duplicatePhotoUpload.single('photo'), async (req, res) => {
  try {
    const { application_no, reason, payment_mode, txn_id } = req.body;

    if (!application_no || !reason || !payment_mode || !txn_id || !req.file) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const [apps] = await pool.query('SELECT application_no FROM applications WHERE application_no=?', [application_no]);
    if (!apps.length) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    const combinedReason = `${reason}\n\nPayment Mode: ${payment_mode}\nTransaction ID: ${txn_id}\nPhoto: ${req.file.path}`;

    await pool.query(
      `INSERT INTO duplicate_requests (application_no, reason, status) VALUES (?, ?, 'pending')`,
      [application_no, combinedReason]
    );

    res.json({ success: true, message: 'Duplicate application submitted successfully.' });
  } catch (e) {
    if (e.message === 'Only JPG/JPEG photo is allowed.') {
      return res.status(400).json({ success: false, message: e.message });
    }
    res.status(500).json({ success: false, message: e.message || 'Submission failed' });
  }
});

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

module.exports = router;