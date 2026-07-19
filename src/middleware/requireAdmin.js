const { verifyIdentityToken } = require('../services/tokens');
const { isJtiRevoked } = require('../services/sessions');

/**
 * Verifies the Bearer identity token and additionally checks that the user
 * is the designated master admin (ADMIN_UUID env var).
 */
async function requireAdmin(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const token = header.slice(7);
  let payload;
  try {
    payload = await verifyIdentityToken(token);
    if (await isJtiRevoked(payload.jti)) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }

  if (payload.sub !== process.env.ADMIN_UUID) {
    return res.status(403).json({ error: 'Forbidden.' });
  }

  req.userId = payload.sub;
  req.tokenPayload = payload;
  next();
}

module.exports = { requireAdmin };
