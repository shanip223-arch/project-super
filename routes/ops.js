const express = require('express');
const pool = require('../config/db');
const { verifyAuditChain } = require('../utils/immutableAudit');

const router = express.Router();

router.get('/metrics', async (req, res) => {
  const [[queueLatency]] = await pool.query("SELECT AVG(latency_ms) as avg_latency FROM async_jobs WHERE status='completed'");
  const [[workerFailures]] = await pool.query("SELECT COUNT(*) as total FROM queue_worker_health WHERE status='error' AND created_at >= datetime('now', '-24 hour')");
  const [[otpFailures]] = await pool.query("SELECT COUNT(*) as total FROM monitoring_events WHERE metric_type='otp_failure' AND created_at >= datetime('now', '-24 hour')");
  const [[redisReconnects]] = await pool.query("SELECT COUNT(*) as total FROM monitoring_events WHERE metric_type='redis_reconnect' AND created_at >= datetime('now', '-24 hour')");
  res.json({ success: true, metrics: { queue_latency_ms: Number(queueLatency.avg_latency || 0), worker_failures_24h: workerFailures.total, otp_failures_24h: otpFailures.total, redis_reconnects_24h: redisReconnects.total } });
});

router.get('/audit-integrity', async (req, res) => {
  const result = await verifyAuditChain();
  res.status(result.ok ? 200 : 409).json({ success: result.ok, ...result });
});

module.exports = router;
