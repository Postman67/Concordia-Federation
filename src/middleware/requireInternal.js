const { timingSafeEqual } = require('crypto');

/**
 * Middleware that authenticates service-to-service requests from other
 * Concordia services (e.g. Concordia-Social) on the internal network.
 *
 * The caller supplies the shared secret in the X-Internal-Key header.
 * INTERNAL_API_KEY may hold SEVERAL comma-separated keys — rotation is:
 * add the new key here, deploy, switch the caller to it, remove the old key.
 * Comparison is constant-time.
 */
function keyMatches(supplied) {
  const keys = (process.env.INTERNAL_API_KEY || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);

  const suppliedBuf = Buffer.from(String(supplied));
  return keys.some(key => {
    const keyBuf = Buffer.from(key);
    return keyBuf.length === suppliedBuf.length && timingSafeEqual(keyBuf, suppliedBuf);
  });
}

function requireInternal(req, res, next) {
  const key = req.headers['x-internal-key'];
  if (!key || !keyMatches(key)) {
    return res.status(401).json({ error: 'Internal authentication required.' });
  }
  next();
}

module.exports = { requireInternal };
