const fs = require('fs');
const path = require('path');

const BLOCKED_EXTENSIONS = new Set(['.exe','.dll','.bat','.cmd','.sh','.js','.php','.scr','.com','.msi','.ps1']);
const ALLOWED_MIME = new Set(['application/pdf','image/jpeg','image/jpg']);

function hasDoubleExtension(filename = '') {
  const parts = path.basename(filename).toLowerCase().split('.').filter(Boolean);
  if (parts.length < 3) return false;
  const last = `.${parts[parts.length - 1]}`;
  const prev = `.${parts[parts.length - 2]}`;
  return BLOCKED_EXTENSIONS.has(prev) || BLOCKED_EXTENSIONS.has(last);
}

function magicType(buffer) {
  if (buffer.slice(0, 4).toString('hex') === '25504446') return 'application/pdf';
  if (buffer.slice(0, 3).toString('hex') === 'ffd8ff') return 'image/jpeg';
  if (buffer.slice(0, 2).toString('hex') === '4d5a') return 'application/x-msdownload';
  if (buffer.slice(0, 2).toString('hex') === '2321') return 'text/x-shellscript';
  return 'unknown';
}

function validateUploadFile(filePath, originalName, mimeType) {
  const ext = path.extname(originalName || filePath).toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext) || hasDoubleExtension(originalName)) return { ok: false, code: 'BLOCKED_EXTENSION' };
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(32);
  fs.readSync(fd, buf, 0, 32, 0);
  fs.closeSync(fd);
  const detected = magicType(buf);
  if (detected === 'application/x-msdownload' || detected === 'text/x-shellscript') return { ok: false, code: 'EXECUTABLE_SIGNATURE' };
  if (mimeType && !ALLOWED_MIME.has(mimeType)) return { ok: false, code: 'MIME_NOT_ALLOWED', detected };
  if (detected !== 'unknown' && mimeType && detected !== mimeType && !(mimeType === 'image/jpg' && detected === 'image/jpeg')) return { ok: false, code: 'MIME_SPOOFED', detected };
  if (ext === '.pdf' && detected !== 'application/pdf') return { ok: false, code: 'CORRUPTED_PDF' };
  if ((ext === '.jpg' || ext === '.jpeg') && detected !== 'image/jpeg') return { ok: false, code: 'MALFORMED_IMAGE' };
  return { ok: true, detected };
}

module.exports = { validateUploadFile };
