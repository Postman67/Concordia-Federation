/**
 * Session lifetime management — rotating refresh tokens + jti revocation.
 *
 * Identity tokens are short-lived (JWT_EXPIRES_IN, default 1h) and paired
 * with an opaque refresh token (REFRESH_TOKEN_TTL_DAYS, default 30d):
 *
 *  - Only the SHA-256 of a refresh token is stored; the plaintext exists
 *    once, in the response that issued it.
 *  - Refresh is ROTATING: each use revokes the old token and issues a new
 *    one, linked via replaced_by.
 *  - Reuse of a revoked token is treated as theft: the user's entire
 *    refresh-token family is revoked and re-login is required.
 *  - revoked_jtis gives immediate revocation of outstanding identity tokens
 *    (logout / admin action) — checked by requireAuth on every request.
 */
const { randomBytes, createHash } = require('crypto');
const pool = require('../config/db');

const REFRESH_TTL_DAYS = parseInt(process.env.REFRESH_TOKEN_TTL_DAYS, 10) || 30;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

class RefreshReuseError extends Error {}
class InvalidRefreshError extends Error {}

// ─── Refresh tokens ──────────────────────────────────────────────────────────

async function issueRefreshToken(userId) {
  const plaintext = randomBytes(48).toString('hex');
  const result = await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + make_interval(days => $3))
     RETURNING id`,
    [userId, sha256(plaintext), REFRESH_TTL_DAYS]
  );
  return { plaintext, id: result.rows[0].id };
}

/**
 * Validates and rotates a refresh token. Returns { userId, plaintext } of
 * the replacement. Throws RefreshReuseError (family revoked) on reuse of a
 * revoked token, InvalidRefreshError otherwise.
 */
async function rotateRefreshToken(plaintext) {
  const result = await pool.query(
    `SELECT id, user_id, expires_at, revoked_at
     FROM refresh_tokens WHERE token_hash = $1`,
    [sha256(plaintext)]
  );

  if (result.rowCount === 0) throw new InvalidRefreshError('Unknown refresh token.');
  const row = result.rows[0];

  if (row.revoked_at) {
    // Rotation means a legitimate client never presents a revoked token —
    // someone is replaying a stolen one. Kill the whole family.
    await revokeAllForUser(row.user_id);
    throw new RefreshReuseError('Refresh token reuse detected.');
  }
  if (new Date(row.expires_at) <= new Date()) {
    throw new InvalidRefreshError('Refresh token expired.');
  }

  const next = await issueRefreshToken(row.user_id);
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = NOW(), replaced_by = $2 WHERE id = $1`,
    [row.id, next.id]
  );
  return { userId: row.user_id, plaintext: next.plaintext };
}

async function revokeRefreshToken(plaintext) {
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = NOW()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [sha256(plaintext)]
  );
}

async function revokeAllForUser(userId) {
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );
}

// ─── Identity-token (jti) revocation ─────────────────────────────────────────

/** Blacklists a jti until the token's own expiry (exp, unix seconds). */
async function revokeJti(jti, expSeconds) {
  if (!jti) return;
  await pool.query(
    `INSERT INTO revoked_jtis (jti, expires_at)
     VALUES ($1, to_timestamp($2)) ON CONFLICT (jti) DO NOTHING`,
    [jti, expSeconds]
  );
}

async function isJtiRevoked(jti) {
  if (!jti) return false; // legacy tokens without jti can't be blacklisted
  const result = await pool.query('SELECT 1 FROM revoked_jtis WHERE jti = $1', [jti]);
  return result.rowCount > 0;
}

/** Opportunistic prune of expired blacklist rows (called from admin metrics). */
async function pruneRevokedJtis() {
  await pool.query('DELETE FROM revoked_jtis WHERE expires_at < NOW()');
}

module.exports = {
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  revokeJti,
  isJtiRevoked,
  pruneRevokedJtis,
  RefreshReuseError,
  InvalidRefreshError,
};
