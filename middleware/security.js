const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.GLOBAL_RATE_LIMIT_MAX || 400),
  standardHeaders: true,
  legacyHeaders: false
});

function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const cookieToken = req.headers['x-csrf-cookie'];
  const headerToken = req.headers['x-csrf-token'];
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ success: false, message: 'CSRF validation failed' });
  }
  return next();
}

function issueCsrf(req, res, next) {
  const token = crypto.randomBytes(16).toString('hex');
  res.setHeader('x-csrf-cookie', token);
  next();
}

module.exports = { globalLimiter, csrfGuard, issueCsrf };
