const { runtimeSnapshot, emitSystemEvent } = require('./monitoring');
const { processDuplicateQueue } = require('./duplicateQueueProcessor');

let metrics = { processed: 0, failed: 0, lastError: null, mode: 'local' };
let redis = null;
let queue = null;
let worker = null;
let scheduler = null;

async function initQueues() {
  const redisUrl = process.env.REDIS_URL;
  const enable = process.env.QUEUE_BACKEND === 'redis' || !!redisUrl;
  if (!enable) return { mode: 'local' };
  try {
    const IORedis = require('ioredis');
    const { Queue, Worker, QueueScheduler } = require('bullmq');
    redis = new IORedis(redisUrl || 'redis://127.0.0.1:6379', { maxRetriesPerRequest: null });
    queue = new Queue('duplicate-certificates', { connection: redis, defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000, removeOnFail: 5000 } });
    scheduler = new QueueScheduler('duplicate-certificates', { connection: redis });
    worker = new Worker('duplicate-certificates', async (job) => {
      if (job.name === 'process_duplicate') await processDuplicateQueue();
      metrics.processed += 1;
      return { ok: true };
    }, { connection: redis, concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '3', 10) });
    worker.on('failed', async (job, err) => { metrics.failed += 1; metrics.lastError = String(err.message || err); await emitSystemEvent({ event_type: 'queue_job_failed', severity: 'error', trace_id: job?.data?.trace_id || null, payload: { jobId: job?.id, name: job?.name, error: metrics.lastError } }); });
    metrics.mode = 'redis';
    await emitSystemEvent({ event_type: 'queue_initialized', payload: { mode: 'redis' } });
    return { mode: 'redis' };
  } catch (e) {
    metrics.mode = 'local_fallback';
    metrics.lastError = String(e.message || e);
    await emitSystemEvent({ event_type: 'queue_init_failed', severity: 'warn', payload: { error: metrics.lastError } });
    return { mode: 'local_fallback', error: metrics.lastError };
  }
}

async function enqueueDuplicateProcessing(trace_id) {
  if (queue) {
    await queue.add('process_duplicate', { trace_id }, { jobId: `dup-${Date.now()}-${Math.random().toString(16).slice(2)}` });
  }
}

async function getQueueStatus() {
  if (queue) {
    const [waiting, active, failed, delayed] = await Promise.all([queue.getWaitingCount(), queue.getActiveCount(), queue.getFailedCount(), queue.getDelayedCount()]);
    return { backend: metrics.mode, waiting, active, failed, delayed, metrics, runtime: runtimeSnapshot() };
  }
  return { backend: metrics.mode, waiting: 0, active: 0, failed: metrics.failed, delayed: 0, metrics, runtime: runtimeSnapshot() };
}

async function closeQueues() {
  if (worker) await worker.close();
  if (scheduler) await scheduler.close();
  if (queue) await queue.close();
  if (redis) await redis.quit();
}

module.exports = { initQueues, enqueueDuplicateProcessing, getQueueStatus, closeQueues };
