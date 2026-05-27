const crypto = require('crypto');

function uuidv7() {
  const unixMs = BigInt(Date.now());
  const timeHex = unixMs.toString(16).padStart(12, '0');
  const rand = crypto.randomBytes(10).toString('hex');
  const part3 = ((parseInt(rand.slice(0, 3), 16) & 0x0fff) | 0x7000).toString(16).padStart(4, '0');
  const part4 = ((parseInt(rand.slice(3, 6), 16) & 0x3fff) | 0x8000).toString(16).padStart(4, '0');
  return `${timeHex.slice(0, 8)}-${timeHex.slice(8, 12)}-${part3}-${part4}-${rand.slice(6, 18)}`;
}

function hashFile(filePath) {
  const fs = require('fs');
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function signVerificationPayload(payload) {
  const secret = process.env.CERT_VERIFICATION_SECRET || process.env.JWT_SECRET;
  const canonical = JSON.stringify(payload);
  return crypto.createHmac('sha256', secret).update(canonical).digest('hex');
}

function buildVerificationPayload(record) {
  const payload = {
    certificate_id: record.certificate_id,
    application_no: record.application_no,
    hash: record.certificate_hash,
    issued_at: record.issued_at,
    timestamp_authority: process.env.TIMESTAMP_AUTHORITY_URL || 'pending',
    pkcs11_provider: process.env.PKCS11_PROVIDER_PATH || 'pending'
  };
  return { payload, signature: signVerificationPayload(payload) };
}

function verifyPayloadSignature(payload, signature) {
  return signVerificationPayload(payload) === signature;
}

module.exports = { uuidv7, hashFile, signVerificationPayload, buildVerificationPayload, verifyPayloadSignature };
