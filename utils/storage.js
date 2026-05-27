const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const base = process.env.STORAGE_ROOT || 'uploads';
const privateDir = path.join(base, 'private');
const tempDir = path.join(base, 'temp');

function ensureStorage() {
  [base, privateDir, tempDir].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
}

function signedToken(filePath, ttlSec = 300) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const secret = process.env.FILE_SIGNING_SECRET || 'dev-secret';
  const sig = crypto.createHmac('sha256', secret).update(`${filePath}:${exp}`).digest('hex');
  return { token: sig, exp };
}

function verifySignedToken(filePath, token, exp) {
  if (!token || !exp || Math.floor(Date.now() / 1000) > Number(exp)) return false;
  return signedToken(filePath, Number(exp) - Math.floor(Date.now() / 1000)).token === token;
}

module.exports = { ensureStorage, signedToken, verifySignedToken, privateDir, tempDir };
