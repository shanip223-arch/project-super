const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../config/db');
const { AppError } = require('../middleware/errors');

const PRIVATE_UPLOAD_DIR = path.join('uploads', 'private', 'duplicate_photos');
const STATUS_FLOW = ['pending', 'under_review', 'approved', 'rejected', 'certificate_generated', 'delivered'];

function ensurePrivateDirs() {
  if (!fs.existsSync(PRIVATE_UPLOAD_DIR)) fs.mkdirSync(PRIVATE_UPLOAD_DIR, { recursive: true });
}

function secureFileName(originalName = 'upload.jpg') {
  const ext = (path.extname(originalName) || '.jpg').toLowerCase();
  const safeExt = ext === '.jpeg' ? '.jpg' : ext;
  return `${Date.now()}_${crypto.randomBytes(12).toString('hex')}${safeExt}`;
}

function validateJpegMagic(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const head = Buffer.alloc(4);
  const tail = Buffer.alloc(2);
  fs.readSync(fd, head, 0, 4, 0);
  const stats = fs.statSync(filePath);
  fs.readSync(fd, tail, 0, 2, Math.max(0, stats.size - 2));
  fs.closeSync(fd);
  const starts = head[0] === 0xff && head[1] === 0xd8;
  const ends = tail[0] === 0xff && tail[1] === 0xd9;
  return starts && ends;
}

async function logDuplicateTimeline({ duplicateRequestId, req, eventType, details, actorId, actorRole }) {
  await pool.query(
    `INSERT INTO duplicate_request_timeline (duplicate_request_id, actor_id, actor_role, event_type, details, trace_id, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [duplicateRequestId, actorId || null, actorRole || 'system', eventType, details || '', req.traceId, req.ip, req.headers['user-agent'] || 'unknown']
  );
}

async function createNotification({ userId, applicationNo, type, title, message, metadata }) {
  await pool.query(
    'INSERT INTO notifications (user_id, application_no, type, title, message, metadata) VALUES (?, ?, ?, ?, ?, ?)',
    [userId || null, applicationNo || null, type, title, message, metadata ? JSON.stringify(metadata) : null]
  );
}

function buildQueueRetry(attempts) {
  const delayMinutes = Math.min(30, Math.max(1, attempts * 2));
  return new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
}

async function processQueuedCertificateGeneration(maxBatch = 5) {
  const [jobs] = await pool.query(
    `SELECT q.*, d.application_no, d.status AS req_status, d.candidate_user_id
     FROM certificate_generation_queue q
     JOIN duplicate_requests d ON d.id=q.duplicate_request_id
     WHERE q.status IN ('queued','retry_scheduled')
       AND (q.next_retry_at IS NULL OR q.next_retry_at <= CURRENT_TIMESTAMP)
     ORDER BY q.id ASC LIMIT ?`,
    [maxBatch]
  );

  for (const job of jobs) {
    const traceId = crypto.randomUUID();
    try {
      await pool.query('BEGIN IMMEDIATE TRANSACTION');
      const [fresh] = await pool.query('SELECT id, status FROM duplicate_requests WHERE id=?', [job.duplicate_request_id]);
      if (!fresh.length) {
        await pool.query('UPDATE certificate_generation_queue SET status=?, last_error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', ['dead', 'request_missing', job.id]);
        await pool.query('COMMIT');
        continue;
      }
      if (fresh[0].status !== 'approved') {
        await pool.query('UPDATE certificate_generation_queue SET status=?, last_error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', ['on_hold', 'not_approved_yet', job.id]);
        await pool.query('COMMIT');
        continue;
      }
      const [existing] = await pool.query('SELECT id FROM certificates WHERE application_no=? AND remarks=? LIMIT 1', [job.application_no, `duplicate_request:${job.duplicate_request_id}`]);
      if (!existing.length) {
        await pool.query(
          'INSERT INTO certificates (application_no, file_path, uploaded_by, status, remarks) VALUES (?, ?, ?, ?, ?)',
          [job.application_no, 'uploads/certificates/pending_generation.pdf', null, 'pending', `duplicate_request:${job.duplicate_request_id}`]
        );
      }
      await pool.query('UPDATE duplicate_requests SET status=?, trace_id=? WHERE id=?', ['certificate_generated', traceId, job.duplicate_request_id]);
      await pool.query('UPDATE certificate_generation_queue SET status=?, attempts=attempts+1, last_error=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?', ['completed', job.id]);
      await pool.query('INSERT INTO duplicate_request_timeline (duplicate_request_id, actor_role, event_type, details, trace_id) VALUES (?, ?, ?, ?, ?)', [job.duplicate_request_id, 'system', 'certificate_generated', 'Certificate generation queued job completed', traceId]);
      await createNotification({ userId: job.candidate_user_id, applicationNo: job.application_no, type: 'duplicate_certificate_ready', title: 'Duplicate request approved', message: 'Certificate generation completed. Download will be available after delivery status.', metadata: { duplicate_request_id: job.duplicate_request_id } });
      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      const attempts = (job.attempts || 0) + 1;
      const maxAttempts = job.max_attempts || 3;
      const nextRetry = buildQueueRetry(attempts);
      const terminal = attempts >= maxAttempts;
      await pool.query(
        'UPDATE certificate_generation_queue SET status=?, attempts=?, last_error=?, next_retry_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
        [terminal ? 'dead' : 'retry_scheduled', attempts, (e && e.message ? e.message : 'unknown').slice(0, 500), terminal ? null : nextRetry, job.id]
      );
    }
  }
}

function assertValidTransition(currentStatus, nextStatus) {
  const allowed = {
    pending: ['under_review', 'rejected'],
    under_review: ['approved', 'rejected'],
    approved: ['certificate_generated', 'rejected'],
    certificate_generated: ['delivered'],
    rejected: [],
    delivered: []
  };
  if (!STATUS_FLOW.includes(currentStatus) || !STATUS_FLOW.includes(nextStatus) || !allowed[currentStatus].includes(nextStatus)) {
    throw new AppError(400, 'INVALID_STATUS_TRANSITION', `Cannot move from ${currentStatus} to ${nextStatus}`);
  }
}

module.exports = {
  ensurePrivateDirs,
  secureFileName,
  validateJpegMagic,
  logDuplicateTimeline,
  createNotification,
  processQueuedCertificateGeneration,
  assertValidTransition,
  PRIVATE_UPLOAD_DIR
};
