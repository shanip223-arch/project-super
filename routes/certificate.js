const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');
const { logAction } = require('../utils/logger');

const router = express.Router();

const storage = multer.diskStorage({
  destination: 'uploads/certificates/',
  filename: (req, file, cb) => {
    const unique = Date.now() + '_' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// Single upload
router.post('/upload', authenticate, requireRole('upload_staff', 'admin'), upload.single('file'), async (req, res) => {
  try {
    const { application_no } = req.body;
    if (!application_no || !req.file) return res.status(400).json({ success: false, message: 'Missing data' });

    const [apps] = await pool.query("SELECT * FROM applications WHERE application_no=?", [application_no]);
    if (!apps.length) return res.status(404).json({ success: false, message: 'Application not found' });
    if (!apps[0].upload_enabled) return res.status(403).json({ success: false, message: 'Upload disabled for this application' });

    await pool.query(
      "INSERT INTO certificates (application_no, file_path, uploaded_by, status) VALUES (?, ?, ?, 'verified')",
      [application_no, req.file.path, req.user.id]
    );
    await pool.query("UPDATE applications SET status='uploaded' WHERE application_no=?", [application_no]);

    await logAction(req.user.id, req.user.role, 'CERT_UPLOAD', `Certificate uploaded for ${application_no}`, req.ip);
    res.json({ success: true, message: 'Certificate uploaded' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Bulk upload (multiple files - filename should be application_no.pdf, but we accept mapping)
router.post('/bulk-upload', authenticate, requireRole('upload_staff', 'admin'), upload.array('files', 200), async (req, res) => {
  try {
    let success = 0, failed = 0;
    const errors = [];
    for (const file of req.files) {
      // Filename like UP12345_25.pdf  → reconstruct UP12345/25
      const baseName = path.basename(file.originalname, path.extname(file.originalname));
      const application_no = baseName.replace('_', '/');
      const [apps] = await pool.query("SELECT * FROM applications WHERE application_no=?", [application_no]);
      if (!apps.length || !apps[0].upload_enabled) {
        failed++; errors.push(`${file.originalname}: invalid or disabled`);
        fs.unlinkSync(file.path);
        continue;
      }
      await pool.query(
        "INSERT INTO certificates (application_no, file_path, uploaded_by, status) VALUES (?, ?, ?, 'verified')",
        [application_no, file.path, req.user.id]
      );
      await pool.query("UPDATE applications SET status='uploaded' WHERE application_no=?", [application_no]);
      success++;
    }
    await logAction(req.user.id, req.user.role, 'BULK_CERT_UPLOAD', `Bulk: ${success} ok, ${failed} fail`, req.ip);
    res.json({ success: true, uploaded: success, failed, errors });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;