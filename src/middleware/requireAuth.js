const { verifyIdentityToken } = require('../services/tokens');
const { isJtiRevoked } = require('../services/sessions');

/**
 * Verifies the Bearer identity token in the Authorization header.
 * Signature is checked against the Federation's own EdDSA key, the `aud`
 * claim must include 'concordia:federation' (server-scoped tokens are
 * rejected by design), and the token's jti must not be on the revocation
 * list (logout / admin revocation take effect immediately).
 * On success, sets req.userId / req.tokenPayload and calls next().
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const token = header.slice(7);
  try {
    const payload = await verifyIdentityToken(token);
    if (await isJtiRevoked(payload.jti)) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }
    req.userId = payload.sub;
    req.tokenPayload = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

module.exports = { requireAuth };
