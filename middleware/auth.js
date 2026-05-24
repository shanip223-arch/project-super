const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  // Also accept token from query param (for direct download links)
  const rawToken = header ? header.split(' ')[1] : req.query.token;
  if (!rawToken) {
    return res.status(401).json({ success: false, message: 'Token missing' });
  }
  try {
    const decoded = jwt.verify(rawToken, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

module.exports = { authenticate };