const crypto = require('crypto');
const pool = require('../config/db');

async function appendAudit(eventType, payload = {}, context = {}) {
  const [[prev]] = await pool.query('SELECT event_hash FROM audit_log_chain ORDER BY id DESC LIMIT 1');
  const prevHash = prev ? prev.event_hash : 'GENESIS';
  const canonical = JSON.stringify({ eventType, payload, prevHash, at: new Date().toISOString() });
  const eventHash = crypto.createHash('sha256').update(canonical).digest('hex');
  await pool.query(
    `INSERT INTO audit_log_chain (event_type, actor_id, actor_role, trace_id, ip_address, user_agent, payload, prev_hash, event_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [eventType, context.actorId || null, context.actorRole || null, context.traceId || null, context.ip || null, context.userAgent || null, JSON.stringify(payload), prevHash, eventHash]
  );
  return eventHash;
}

async function verifyAuditChain() {
  const [rows] = await pool.query('SELECT id, event_type, payload, prev_hash, event_hash, created_at FROM audit_log_chain ORDER BY id ASC');
  let prevHash = 'GENESIS';
  for (const row of rows) {
    const canonical = JSON.stringify({ eventType: row.event_type, payload: JSON.parse(row.payload || '{}'), prevHash, at: new Date(row.created_at).toISOString() });
    const computed = crypto.createHash('sha256').update(canonical).digest('hex');
    if (row.prev_hash !== prevHash || row.event_hash !== computed) return { ok: false, broken_at: row.id };
    prevHash = row.event_hash;
  }
  return { ok: true, records: rows.length };
}

module.exports = { appendAudit, verifyAuditChain };
