const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');
const { logAction } = require('../utils/logger');
const { uuidv7, hashFile, buildVerificationPayload, verifyPayloadSignature } = require('../utils/certificateAuthority');
const { appendAudit } = require('../utils/immutableAudit');

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
    const certificate_id = uuidv7();
    const certificate_hash = hashFile(req.file.path);
    const verification_url = `${req.protocol}://${req.get('host')}/api/certificate/verify/${certificate_id}`;
    const { payload, signature } = buildVerificationPayload({ certificate_id, application_no, certificate_hash, issued_at: new Date().toISOString() });
    await pool.query('INSERT INTO certificate_verifications (certificate_id, application_no, certificate_hash, verification_signature, verification_url, immutable_record_hash) VALUES (?, ?, ?, ?, ?, ?)', [certificate_id, application_no, certificate_hash, signature, verification_url, signature]);
    await pool.query('INSERT INTO verification_audit (certificate_id, action, trace_id, ip_address, user_agent, details) VALUES (?, ?, ?, ?, ?, ?)', [certificate_id, 'CERTIFICATE_ISSUED', req.traceId || null, req.ip, req.headers['user-agent'] || null, JSON.stringify(payload)]);
    await appendAudit('CERTIFICATE_ISSUED', { certificate_id, application_no, verification_url }, { actorId: req.user.id, actorRole: req.user.role, traceId: req.traceId, ip: req.ip, userAgent: req.headers['user-agent'] });
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

router.get('/verify/:certificateId', async (req, res) => {
  try {
    const { certificateId } = req.params;
    const [[record]] = await pool.query('SELECT * FROM certificate_verifications WHERE certificate_id=?', [certificateId]);
    if (!record) return res.status(404).json({ success: false, message: 'Invalid verification URL' });
    const [[cert]] = await pool.query('SELECT * FROM certificates WHERE application_no=? ORDER BY id DESC LIMIT 1', [record.application_no]);
    if (!cert || !cert.file_path || !fs.existsSync(cert.file_path)) return res.status(404).json({ success: false, message: 'Certificate file missing' });
    const liveHash = hashFile(cert.file_path);
    const validHash = liveHash === record.certificate_hash;
    const payload = { certificate_id: record.certificate_id, application_no: record.application_no, hash: record.certificate_hash, issued_at: record.issued_at, timestamp_authority: process.env.TIMESTAMP_AUTHORITY_URL || 'pending', pkcs11_provider: process.env.PKCS11_PROVIDER_PATH || 'pending' };
    const validSignature = verifyPayloadSignature(payload, record.verification_signature);
    await pool.query('INSERT INTO verification_audit (certificate_id, action, trace_id, ip_address, user_agent, details) VALUES (?, ?, ?, ?, ?, ?)', [certificateId, 'VERIFY_ATTEMPT', req.traceId || null, req.ip, req.headers['user-agent'] || null, JSON.stringify({ validHash, validSignature })]);
    await appendAudit('CERTIFICATE_VERIFY', { certificateId, validHash, validSignature }, { traceId: req.traceId, ip: req.ip, userAgent: req.headers['user-agent'] });
    const ok = validHash && validSignature;
    return res.status(ok ? 200 : 409).json({ success: ok, certificate_id: certificateId, application_no: record.application_no, valid_hash: validHash, valid_signature: validSignature, anti_tamper: ok, immutable_record: record.immutable_record_hash });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});
