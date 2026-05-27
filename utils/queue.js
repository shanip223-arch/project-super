const crypto = require('crypto');
const pool = require('../config/db');
const { emit, captureMetric } = require('./structuredLogger');

const hasRedis = () => !!(process.env.REDIS_URL || process.env.REDIS_HOST);
let bullmq = null;
let connection = null;
if (hasRedis()) {
  try {
    bullmq = require('bullmq');
    const IORedis = require('ioredis');
    connection = process.env.REDIS_URL
      ? new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
      : new IORedis({
          host: process.env.REDIS_HOST,
          port: parseInt(process.env.REDIS_PORT || '6379', 10),
          password: process.env.REDIS_PASSWORD || undefined,
          maxRetriesPerRequest: null
        });
  } catch (e) {
    emit('warn', 'queue.redis.unavailable', { error: e.message });
  }
}

const QUEUE_NAMES = ['certificate_generation','duplicate_processing','notifications','otp_retries','bulk_uploads','malware_scan','cleanup','audit_exports','backups','scheduled_maintenance'];
const queues = new Map();

function ensureQueue(name) {
  if (!bullmq || !connection) return null;
  if (!queues.has(name)) {
    const q = new bullmq.Queue(name, { connection, defaultJobOptions: { attempts: 5, removeOnComplete: 1000, removeOnFail: false, backoff: { type: 'exponential', delay: 1500 } } });
    queues.set(name, q);
  }
  return queues.get(name);
}

async function enqueue(name, payload, opts = {}) {
  const traceId = opts.traceId || crypto.randomUUID();
  const dedupKey = opts.dedupKey || `${name}:${JSON.stringify(payload)}`;
  const [existing] = await pool.query('SELECT id FROM async_jobs WHERE dedup_key=? AND status IN ("queued","processing") LIMIT 1', [dedupKey]);
  if (existing.length) return { queued: false, deduplicated: true, traceId };

  await pool.query('INSERT INTO async_jobs (queue_name, trace_id, dedup_key, payload, status, run_after, progress) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    name,
    traceId,
    dedupKey,
    JSON.stringify(payload),
    'queued',
    opts.delayMs ? new Date(Date.now() + opts.delayMs).toISOString() : null,
    0
  ]);

  const q = ensureQueue(name);
  if (q) {
    await q.add(name, { ...payload, trace_id: traceId }, { jobId: `${dedupKey}:${traceId}`, delay: opts.delayMs || 0, attempts: opts.attempts || 5, backoff: { type: 'exponential', delay: opts.backoffDelay || 2000 } });
  }
  emit('info', 'queue.job.enqueued', { queue: name, traceId, dedupKey });
  return { queued: true, traceId };
}

async function recoverQueuedJobs(limit = 100) {
  const [jobs] = await pool.query('SELECT * FROM async_jobs WHERE status IN ("queued", "retry_scheduled") AND (run_after IS NULL OR run_after <= CURRENT_TIMESTAMP) ORDER BY id ASC LIMIT ?', [limit]);
  return jobs;
}

async function markJobStatus(id, status, lastError = null) {
  await pool.query('UPDATE async_jobs SET status=?, last_error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [status, lastError, id]);
}

async function runFallbackProcessor(handlers) {
  const jobs = await recoverQueuedJobs(50);
  for (const job of jobs) {
    try {
      await markJobStatus(job.id, 'processing');
      const payload = JSON.parse(job.payload || '{}');
      if (!handlers[job.queue_name]) throw new Error(`no_handler:${job.queue_name}`);
      await handlers[job.queue_name](payload, job);
      await markJobStatus(job.id, 'completed');
    } catch (e) {
      const attempts = job.attempts + 1;
      const dead = attempts >= job.max_attempts;
      await pool.query('UPDATE async_jobs SET attempts=?, status=?, run_after=?, last_error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [
        attempts,
        dead ? 'dead_letter' : 'retry_scheduled',
        dead ? null : new Date(Date.now() + Math.min(60000, 1000 * 2 ** attempts)).toISOString(),
        e.message.slice(0, 600),
        job.id
      ]);
      await captureMetric('queue_failure', dead ? 'dead_letter' : 'retry', { queue: job.queue_name, error: e.message, attempts }, job.trace_id);
    }
  }
}

module.exports = { enqueue, runFallbackProcessor, hasRedis, QUEUE_NAMES, connection };
