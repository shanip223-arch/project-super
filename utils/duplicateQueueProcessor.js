const pool = require('../config/db');

let running = false;

async function processDuplicateQueue() {
  if (running) return;
  running = true;
  try {
    const [jobs] = await pool.query(`SELECT q.*, d.application_no, d.status AS request_status
      FROM certificate_generation_queue q
      JOIN duplicate_requests d ON d.id=q.duplicate_request_id
      WHERE q.status='queued' AND d.status='approved' AND (q.next_retry_at IS NULL OR q.next_retry_at <= CURRENT_TIMESTAMP)
      ORDER BY q.id ASC LIMIT 5`);

    for (const job of jobs) {
      try {
        await pool.query('BEGIN IMMEDIATE TRANSACTION');
        await pool.query("UPDATE certificate_generation_queue SET status='processing', attempts=attempts+1, updated_at=CURRENT_TIMESTAMP WHERE id=?", [job.id]);
        await pool.query("UPDATE duplicate_requests SET status='certificate_generated', delivered_at=CURRENT_TIMESTAMP WHERE id=?", [job.duplicate_request_id]);
        await pool.query("INSERT INTO duplicate_request_timeline (duplicate_request_id, actor_role, event_type, details) VALUES (?, 'system', 'certificate_generated', 'Queued generation completed')", [job.duplicate_request_id]);
        await pool.query("INSERT INTO notifications (application_no, type, title, message, metadata) VALUES (?, 'certificate_ready', 'Certificate Ready', 'Your duplicate certificate is available in dashboard.', ?)", [job.application_no, JSON.stringify({ request_id: job.duplicate_request_id })]);
        await pool.query("UPDATE certificate_generation_queue SET status='completed', updated_at=CURRENT_TIMESTAMP WHERE id=?", [job.id]);
        await pool.query('COMMIT');
      } catch (err) {
        await pool.query('ROLLBACK');
        const retryAt = "datetime('now', '+2 minutes')";
        await pool.query(`UPDATE certificate_generation_queue
          SET status=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'queued' END,
              last_error=?,
              next_retry_at=${retryAt},
              updated_at=CURRENT_TIMESTAMP
          WHERE id=?`, [String(err.message || err), job.id]);
      }
    }
  } finally {
    running = false;
  }
}

function startDuplicateQueueProcessor() {
  setInterval(() => { processDuplicateQueue().catch(() => {}); }, 15000);
}

module.exports = { startDuplicateQueueProcessor, processDuplicateQueue };
