const pool = require('../config/db');

function emit(level, event, payload = {}) {
  const row = {
    ts: new Date().toISOString(),
    level,
    event,
    ...payload
  };
  const line = JSON.stringify(row);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

async function captureMetric(metricType, status, details = {}, traceId = null) {
  try {
    await pool.query(
      'INSERT INTO monitoring_events (metric_type, status, details, trace_id) VALUES (?, ?, ?, ?)',
      [metricType, status, JSON.stringify(details), traceId]
    );
  } catch (e) {
    emit('error', 'monitoring.capture.failed', { error: e.message, metricType });
  }
}

module.exports = { emit, captureMetric };
