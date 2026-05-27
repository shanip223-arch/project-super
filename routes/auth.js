const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { generateOTP } = require('../utils/otpGenerator');
const { sendOTP } = require('../utils/smsSender');
const { logAction } = require('../utils/logger');
const { AppError, asyncHandler } = require('../middleware/errors');

const router = express.Router();

const getCfg = async (key, fallback = null) => {
  const [rows] = await pool.query('SELECT value FROM system_config WHERE key=? LIMIT 1', [key]);
  return rows.length ? rows[0].value : fallback;
};

// Admin/Staff login
router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) throw new AppError(400, 'MISSING_CREDENTIALS', 'Missing credentials');

  const [rows] = await pool.query("SELECT * FROM users WHERE username=? AND is_active=1", [username]);
  if (!rows.length) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');

  const user = rows[0];
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, name: user.full_name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRY || '15m' }
  );

  await logAction(user.id, user.role, 'LOGIN', `User ${username} logged in`, req.ip);
  res.json({ success: true, token, role: user.role, name: user.full_name, trace_id: req.traceId });
}));

// Candidate OTP request
router.post('/request-otp', asyncHandler(async (req, res) => {
  const { application_no } = req.body;
  if (!application_no) throw new AppError(400, 'APPLICATION_NUMBER_REQUIRED', 'Application No required');

  const [apps] = await pool.query("SELECT * FROM applications WHERE application_no=?", [application_no]);
  if (!apps.length) throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Application not found');

  if (apps[0].status === 'suspended' || apps[0].is_active === 0) {
    throw new AppError(403, 'APPLICATION_ACCESS_BLOCKED', 'Application access is currently blocked');
  }

  const otp = generateOTP();
  const expires = new Date(Date.now() + (parseInt(process.env.OTP_EXPIRY_MINUTES) || 5) * 60000);
  await pool.query(
    "INSERT INTO otp_codes (application_no, otp, expires_at) VALUES (?, ?, ?)",
    [application_no, otp, expires]
  );

  const mobile = apps[0].mobile || '';
  const smsResult = await sendOTP(mobile, otp, application_no);
  if (!smsResult.success) {
    console.error(`[OTP] SMS delivery failed for ${application_no}:`, smsResult.error);
  }

  await logAction(null, 'candidate', 'OTP_REQUEST', `OTP requested for ${application_no}`, req.ip);
  res.json({ success: true, message: 'OTP sent to registered mobile', trace_id: req.traceId });
}));

// Candidate OTP verify
router.post('/verify-otp', asyncHandler(async (req, res) => {
  const { application_no, otp } = req.body;
  if (!application_no || !otp) throw new AppError(400, 'MISSING_DATA', 'Missing data');

  const [rows] = await pool.query(
    "SELECT * FROM otp_codes WHERE application_no=? AND otp=? AND used=0 AND expires_at > ? ORDER BY id DESC LIMIT 1",
    [application_no, otp, new Date()]
  );
  if (!rows.length) throw new AppError(401, 'OTP_EXPIRED', 'OTP has expired.');

  await pool.query("UPDATE otp_codes SET used=1 WHERE id=?", [rows[0].id]);

  const token = jwt.sign(
    { application_no, role: 'candidate' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRY || '15m' }
  );

  await logAction(null, 'candidate', 'LOGIN', `Candidate ${application_no} logged in`, req.ip);
  res.json({ success: true, token, role: 'candidate', application_no, trace_id: req.traceId });
}));

router.post('/register/request-otp', asyncHandler(async (req, res) => {
  const enabled = await getCfg('registration_enabled', '0');
  if (enabled !== '1') throw new AppError(403, 'REGISTRATION_DISABLED', 'Registration is disabled.');
  const { mobile } = req.body;
  if (!/^\d{10}$/.test(String(mobile || ''))) throw new AppError(400, 'INVALID_MOBILE', 'Valid mobile required.');
  const otp = generateOTP();
  const expires = new Date(Date.now() + 5 * 60000);
  await pool.query('INSERT INTO otp_codes (application_no, otp, expires_at) VALUES (?, ?, ?)', [`REG-${mobile}`, otp, expires]);
  await sendOTP(mobile, otp, `REG-${mobile}`);
  res.json({ success: true, message: 'Registration OTP sent.', trace_id: req.traceId });
}));

router.post('/register', asyncHandler(async (req, res) => {
  const enabled = await getCfg('registration_enabled', '0');
  if (enabled !== '1') throw new AppError(403, 'REGISTRATION_DISABLED', 'Registration is disabled.');
  const mode = await getCfg('registration_mode', 'admin_upload_only');
  const { full_name, mobile, email, state, enrollment_no, identity_no, address, otp, terms_accepted, captcha_token } = req.body;
  if (!full_name || !mobile || !otp || String(terms_accepted) !== 'true') throw new AppError(400, 'VALIDATION_ERROR', 'Missing required fields');
  if (!captcha_token) throw new AppError(400, 'CAPTCHA_REQUIRED', 'Captcha token required.');
  const [otpRow] = await pool.query('SELECT id FROM otp_codes WHERE application_no=? AND otp=? AND used=0 AND expires_at > ? ORDER BY id DESC LIMIT 1', [`REG-${mobile}`, otp, new Date()]);
  if (!otpRow.length) throw new AppError(401, 'OTP_INVALID', 'Invalid or expired OTP.');
  await pool.query('UPDATE otp_codes SET used=1 WHERE id=?', [otpRow[0].id]);
  const [dupe] = await pool.query('SELECT id FROM registrations WHERE mobile=? OR email=? OR enrollment_no=? LIMIT 1', [mobile, email || '', enrollment_no || '']);
  if (dupe.length) throw new AppError(409, 'DUPLICATE_REGISTRATION', 'Registration already exists.');
  const autoApprove = mode === 'public_registration' ? 1 : 0;
  const appNo = `REG${Date.now()}`;
  await pool.query(`INSERT INTO registrations (application_no, full_name, mobile, email, state, enrollment_no, identity_no, address, otp_verified, captcha_verified, terms_accepted, status, trace_id, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, ?, ?, ?, ?)`, [appNo, full_name, mobile, email || null, state || null, enrollment_no || null, identity_no || null, address || null, autoApprove ? 'approved' : 'pending', req.traceId, req.ip, req.headers['user-agent'] || 'unknown']);
  if (autoApprove) {
    await pool.query('INSERT INTO applications (application_no, name, district, mobile, status) VALUES (?, ?, ?, ?, ?)', [appNo, full_name, state || '', mobile, 'pending']);
  }
  res.json({ success: true, message: 'Registration submitted.', status: autoApprove ? 'approved' : 'pending', application_no: appNo, trace_id: req.traceId });
}));

module.exports = router;
