const express = require('express');
const pool = require('../config/db');
const { verifyAuditChain } = require('../utils/immutableAudit');

const router = express.Router();

router.get('/metrics', async (req, res) => {
  const [[queueLatency]] = await pool.query("SELECT AVG(latency_ms) as avg_latency FROM async_jobs WHERE status='completed'");
  const [[workerFailures]] = await pool.query("SELECT COUNT(*) as total FROM queue_worker_health WHERE status='error' AND created_at >= datetime('now', '-24 hour')");
  const [[otpFailures]] = await pool.query("SELECT COUNT(*) as total FROM monitoring_events WHERE metric_type='otp_failure' AND created_at >= datetime('now', '-24 hour')");
  const [[redisReconnects]] = await pool.query("SELECT COUNT(*) as total FROM monitoring_events WHERE metric_type='redis_reconnect' AND created_at >= datetime('now', '-24 hour')");
  const [[infectedUploads]] = await pool.query("SELECT COUNT(*) as total FROM malware_scan_events WHERE infected=1 AND created_at >= datetime('now', '-24 hour')");
  const [[scanFailures]] = await pool.query("SELECT COUNT(*) as total FROM malware_scan_events WHERE verdict IN ('scan_error','scanner_unavailable') AND created_at >= datetime('now', '-24 hour')");
  const [[avgScan]] = await pool.query("SELECT AVG(duration_ms) as avg_duration FROM malware_scan_events WHERE status='completed'");
  res.json({ success: true, metrics: { queue_latency_ms: Number(queueLatency.avg_latency || 0), worker_failures_24h: workerFailures.total, otp_failures_24h: otpFailures.total, redis_reconnects_24h: redisReconnects.total, infected_uploads_24h: infectedUploads.total, scan_failures_24h: scanFailures.total, avg_scan_duration_ms: Number(avgScan.avg_duration || 0) } });
});

router.get('/audit-integrity', async (req, res) => {
  const result = await verifyAuditChain();
  res.status(result.ok ? 200 : 409).json({ success: result.ok, ...result });
});

module.exports = router;
