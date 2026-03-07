const jwt = require('jsonwebtoken');

/**
 * Verifies the Bearer JWT and additionally checks that the user is the
 * designated master admin (ADMIN_UUID env var).
 */
function requireAdmin(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const token = header.slice(7);
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }

  if (payload.sub !== process.env.ADMIN_UUID) {
    return res.status(403).json({ error: 'Forbidden.' });
  }

  req.userId = payload.sub;
  next();
}

module.exports = { requireAdmin };
