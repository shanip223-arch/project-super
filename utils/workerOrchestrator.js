const crypto = require('crypto');
const pool = require('../config/db');
const { emit, captureMetric } = require('./structuredLogger');
const { connection } = require('./queue');

const hasBull = !!connection;
let bullmq = null;
if (hasBull) bullmq = require('bullmq');

const WORKER_CONFIGS = {
  certificate_generation: { concurrency: 2 },
  duplicate_processing: { concurrency: 3 },
  notifications: { concurrency: 5 },
  otp_retries: { concurrency: 4 },
  bulk_uploads: { concurrency: 2 },
  malware_scan: { concurrency: 2 },
  cleanup: { concurrency: 1 },
  audit_exports: { concurrency: 1 },
  backups: { concurrency: 1 },
  scheduled_maintenance: { concurrency: 1 }
};

const workers = new Map();

async function withJobLock(jobId, fn) {
  const [rows] = await pool.query('SELECT status FROM async_jobs WHERE id=?', [jobId]);
  if (!rows.length || rows[0].status === 'completed') return { skipped: true };
  return fn();
}

async function updateHealth(workerName, status, details = {}, traceId = null) {
  await pool.query('INSERT INTO queue_worker_health(worker_name, status, details, trace_id) VALUES (?, ?, ?, ?)', [workerName, status, JSON.stringify(details), traceId]);
}

function createProcessor(queueName) {
  return async (bullJob) => {
    const payload = bullJob.data || {};
    const traceId = payload.trace_id || crypto.randomUUID();
    const jobId = payload.async_job_id;
    const start = Date.now();
    await updateHealth(queueName, 'running', { bullId: bullJob.id }, traceId);
    if (!jobId) return;
    return withJobLock(jobId, async () => {
      await pool.query('UPDATE async_jobs SET status=?, worker_name=?, started_at=CURRENT_TIMESTAMP WHERE id=?', ['processing', queueName, jobId]);
      await bullJob.updateProgress(10);
      if (queueName === 'malware_scan' && payload.file_path) {
        const suspicious = /\.exe$|\.bat$/i.test(payload.file_path);
        if (suspicious) {
          await pool.query('INSERT INTO scan_quarantine(original_path, quarantine_path, reason, trace_id) VALUES (?, ?, ?, ?)', [payload.file_path, `uploads/quarantine/${Date.now()}_${payload.file_path.split('/').pop()}`, 'signature_match', traceId]);
          throw new Error('malware_detected');
        }
      }
      await bullJob.updateProgress(70);
      await pool.query('UPDATE async_jobs SET status=?, progress=?, completed_at=CURRENT_TIMESTAMP, latency_ms=? WHERE id=?', ['completed', 100, Date.now() - start, jobId]);
      await captureMetric('queue_completed', 'ok', { queue: queueName }, traceId);
    });
  };
}

function createWorkers() {
  if (!hasBull || workers.size) return;
  Object.entries(WORKER_CONFIGS).forEach(([queueName, cfg]) => {
    const worker = new bullmq.Worker(queueName, createProcessor(queueName), {
      connection,
      concurrency: cfg.concurrency
    });
    worker.on('failed', async (job, err) => {
      const asyncId = job?.data?.async_job_id;
      const attempts = (job?.attemptsMade || 0) + 1;
      if (asyncId) {
        const dead = attempts >= 5;
        await pool.query('UPDATE async_jobs SET attempts=?, status=?, last_error=?, run_after=? WHERE id=?', [attempts, dead ? 'dead_letter' : 'retry_scheduled', err.message.slice(0, 600), dead ? null : new Date(Date.now() + Math.min(300000, 2000 * (2 ** attempts))).toISOString(), asyncId]);
        await pool.query('INSERT INTO queue_retry_history(async_job_id, trace_id, queue_name, retry_no, reason) VALUES (?, ?, ?, ?, ?)', [asyncId, job?.data?.trace_id || null, queueName, attempts, err.message.slice(0, 250)]);
      }
      await updateHealth(queueName, 'failed', { error: err.message });
    });
    worker.on('completed', async (job) => updateHealth(queueName, 'completed', { bullId: job.id }, job?.data?.trace_id));
    worker.on('error', async (err) => captureMetric('worker_crash', 'error', { queue: queueName, error: err.message }));
    workers.set(queueName, worker);
  });
}

async function shutdownWorkers() {
  for (const worker of workers.values()) await worker.close();
}

module.exports = { createWorkers, shutdownWorkers, WORKER_CONFIGS };
