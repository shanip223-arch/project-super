const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { generateOTP } = require('../utils/otpGenerator');
const { sendOTP } = require('../utils/smsSender');
const { logAction } = require('../utils/logger');
const { AppError, asyncHandler } = require('../middleware/errors');

const router = express.Router();

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

module.exports = router;