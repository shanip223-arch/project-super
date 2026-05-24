const express = require('express');
const path = require('path');
const fs = require('fs');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');
const { requireNoActiveObjection } = require('../middleware/objectionLock');

const router = express.Router();

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