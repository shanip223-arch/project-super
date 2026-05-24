const pool = require('../config/db');

const LOCKED_STATUSES = ['open', 'under_review', 'rejected', 'objection_pending', 'objection_reupload_required', 'objection_under_review'];

async function requireNoActiveObjection(req, res, next) {
  try {
    if (!req.user || req.user.role !== 'candidate') return next();
    const placeholders = LOCKED_STATUSES.map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT id, status FROM objections WHERE application_no=? AND status IN (${placeholders}) LIMIT 1`,
      [req.user.application_no, ...LOCKED_STATUSES]
    );
    if (rows.length) {
      return res.status(423).json({
        success: false,
        code: 'ACTIVE_OBJECTION_LOCK',
        message: 'Active objection must be completed before using other workflow actions.',
        objection: rows[0]
      });
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireNoActiveObjection, LOCKED_STATUSES };
