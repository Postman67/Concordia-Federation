/**
 * Middleware that authenticates service-to-service requests from other
 * Concordia services (e.g. Concordia-Social) on the internal network.
 *
 * The caller must supply the shared secret in the X-Internal-Key header.
 * The value must match the INTERNAL_API_KEY environment variable.
 */
function requireInternal(req, res, next) {
  const key = req.headers['x-internal-key'];
  if (!key || key !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Internal authentication required.' });
  }
  next();
}

module.exports = { requireInternal };
