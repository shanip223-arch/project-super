const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const base = process.env.STORAGE_ROOT || 'uploads';
const privateDir = path.join(base, 'private');
const publicDir = path.join(base, 'public');
const tempDir = path.join(base, 'temp');
const quarantineDir = path.join(base, 'quarantine');

function ensureStorage() {
  [base, privateDir, publicDir, tempDir, quarantineDir].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
}

function activeProvider() {
  return process.env.STORAGE_PROVIDER || 'local'; // s3|r2|minio|local
}

function signedToken(filePath, ttlSec = 300) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const secret = process.env.FILE_SIGNING_SECRET || 'dev-secret';
  const sig = crypto.createHmac('sha256', secret).update(`${filePath}:${exp}`).digest('hex');
  return { token: sig, exp };
}

function verifySignedToken(filePath, token, exp) {
  if (!token || !exp || Math.floor(Date.now() / 1000) > Number(exp)) return false;
  const secret = process.env.FILE_SIGNING_SECRET || 'dev-secret';
  const sig = crypto.createHmac('sha256', secret).update(`${filePath}:${exp}`).digest('hex');
  return sig === token;
}

function fileIntegrity(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

module.exports = { ensureStorage, signedToken, verifySignedToken, fileIntegrity, activeProvider, privateDir, publicDir, tempDir, quarantineDir };
