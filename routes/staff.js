const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');

const router = express.Router();

// Staff dashboard
router.get('/dashboard', authenticate, requireRole('upload_staff', 'objection_staff'), async (req, res) => {
  if (req.user.role === 'upload_staff') {
    const [[pending]] = await pool.query("SELECT COUNT(*) AS total FROM applications WHERE status='pending' AND upload_enabled=1");
    const [[uploaded]] = await pool.query("SELECT COUNT(*) AS total FROM certificates WHERE uploaded_by=?", [req.user.id]);
    return res.json({ success: true, role: req.user.role, stats: { pending: pending.total, uploaded: uploaded.total } });
  } else {
    const [[open]] = await pool.query("SELECT COUNT(*) AS total FROM objections WHERE status='open'");
    const [[done]] = await pool.query("SELECT COUNT(*) AS total FROM objections WHERE handled_by=?", [req.user.id]);
    return res.json({ success: true, role: req.user.role, stats: { open: open.total, handled: done.total } });
  }
});

// Assigned applications (for upload staff & objection staff)
router.get('/applications', authenticate, requireRole('upload_staff', 'objection_staff'), async (req, res) => {
  const search = (req.query.search || '').trim();
  const [rows] = await pool.query(
    "SELECT * FROM applications WHERE upload_enabled=1 AND (application_no LIKE ? OR name LIKE ?) ORDER BY id DESC LIMIT 500",
    [`%${search}%`, `%${search}%`]
  );
  res.json({ success: true, data: rows });
});

// Get single application
router.get('/applications/:id', authenticate, requireRole('upload_staff'), async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM applications WHERE id=?", [req.params.id]);
  if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, data: rows[0] });
});

// Edit application
router.put('/edit/:id', authenticate, requireRole('upload_staff'), async (req, res) => {
  const { name, status } = req.body;
  await pool.query(
    "UPDATE applications SET name=?, status=? WHERE id=?",
    [name, status, req.params.id]
  );
  res.json({ success: true });
});

// Override upload permissions
router.post('/override', authenticate, requireRole('upload_staff'), async (req, res) => {
  const { application_no, upload_enabled, final_chance } = req.body;
  await pool.query(
    "UPDATE applications SET upload_enabled=?, final_chance=? WHERE application_no=?",
    [upload_enabled ? 1 : 0, final_chance ? 1 : 0, application_no]
  );
  res.json({ success: true });
});

// Duplicate requests
router.get('/duplicates', authenticate, requireRole('upload_staff', 'admin'), async (req, res) => {
  // Return only duplicate request records saved in the database.
  try {
    const [rows] = await pool.query("SELECT * FROM duplicate_requests WHERE status='pending' ORDER BY id DESC");
    res.json({ success: true, data: rows });
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      res.json({ success: true, data: [] });
    } else {
      res.status(500).json({ success: false, message: err.message });
    }
  }
});

router.post('/duplicates/resolve', authenticate, requireRole('upload_staff', 'admin'), async (req, res) => {
  try {
    const { id, decision, remarks } = req.body;
    await pool.query("UPDATE duplicate_requests SET status=?, remarks=? WHERE id=?", [decision, remarks, id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;