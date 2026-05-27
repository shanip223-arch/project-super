const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AppError } = require('../middleware/errors');

const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg']);
const ALLOWED_EXT = new Set(['.jpg', '.jpeg']);
const ALLOWED_MAGIC = [Buffer.from([0xff, 0xd8, 0xff])];

function sanitizeText(input, max = 500) {
  return String(input || '').replace(/[<>]/g, '').trim().slice(0, max);
}

function safeUnlink(filePath) {
  if (!filePath) return;
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
}

function validateUploadedJpeg(file) {
  if (!file) throw new AppError(400, 'INVALID_IMAGE', 'Photo is required.');
  if (file.size > 2 * 1024 * 1024) throw new AppError(400, 'FILE_TOO_LARGE', 'Photo exceeds size limit.');
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED_EXT.has(ext) || !ALLOWED_MIME.has(file.mimetype)) {
    throw new AppError(400, 'INVALID_IMAGE', 'Only JPG/JPEG allowed.');
  }
  const data = fs.readFileSync(file.path);
  if (!ALLOWED_MAGIC.some(sig => data.subarray(0, sig.length).equals(sig))) {
    throw new AppError(400, 'CORRUPTED_UPLOAD', 'Uploaded file is corrupted or spoofed.');
  }
  return true;
}

function toPrivateUploadPath(tempPath, appNo) {
  const ext = '.jpg';
  const secureName = `${Date.now()}_${crypto.randomUUID()}_${appNo}${ext}`;
  const finalPath = path.join('uploads', 'verified', secureName);
  fs.renameSync(tempPath, finalPath);
  return finalPath;
}

function makeNotification({ application_no, type, title, message, metadata }) {
  return [application_no, type, title, message, JSON.stringify(metadata || {})];
}

module.exports = {
  sanitizeText,
  safeUnlink,
  validateUploadedJpeg,
  toPrivateUploadPath,
  makeNotification
};
