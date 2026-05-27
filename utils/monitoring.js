const crypto = require('crypto');
const os = require('os');
const pool = require('../config/db');

async function emitSystemEvent({ event_type, severity = 'info', trace_id = null, actor_role = null, actor_id = null, ip_address = null, user_agent = null, payload = {} }) {
  const payloadJson = JSON.stringify(payload || {});
  const [prev] = await pool.query('SELECT hash FROM system_events ORDER BY id DESC LIMIT 1');
  const prevHash = prev[0]?.hash || '';
  const hash = crypto.createHash('sha256').update(`${prevHash}|${event_type}|${severity}|${trace_id || ''}|${payloadJson}`).digest('hex');
  await pool.query(`INSERT INTO system_events (event_type, severity, trace_id, actor_role, actor_id, ip_address, user_agent, payload, prev_hash, hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [event_type, severity, trace_id, actor_role, actor_id, ip_address, user_agent, payloadJson, prevHash, hash]);
}

function runtimeSnapshot() {
  const m = process.memoryUsage();
  return { rss: m.rss, heapUsed: m.heapUsed, heapTotal: m.heapTotal, uptimeSec: process.uptime(), host: os.hostname() };
}

module.exports = { emitSystemEvent, runtimeSnapshot };
