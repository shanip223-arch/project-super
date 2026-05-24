const jwt = require('jsonwebtoken');

function superadminAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const secret  = process.env.SUPERADMIN_JWT_SECRET || process.env.JWT_SECRET;
    const decoded = jwt.verify(token, secret);

    if (decoded.role !== 'superadmin') {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    req.superAdmin = decoded;
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
}

module.exports = { superadminAuth };
