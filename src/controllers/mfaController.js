/**
 * TOTP two-factor authentication.
 *
 * Flow:
 *  1. POST /api/auth/mfa/setup    (auth)  → secret + otpauth:// URI (disabled until confirmed)
 *  2. POST /api/auth/mfa/enable   (auth)  → verify a live code, enable, return backup codes ONCE
 *  3. login with password         → { mfa_required, mfa_token } instead of a session
 *  4. POST /api/auth/mfa/verify  (public) → mfa_token + TOTP/backup code → real token pair
 *  5. POST /api/auth/mfa/disable  (auth)  → verify a code, remove 2FA
 */
const { randomBytes, createHash } = require('crypto');
const { decodeJwt } = require('jose');
const pool = require('../config/db');
const { generateSecret, verifyCode, provisioningUri } = require('../services/totp');
const { signIdentityToken, verifyMfaToken } = require('../services/tokens');
const sessions = require('../services/sessions');
const { logEvent, EVENT } = require('../metrics/events');

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const BACKUP_CODE_COUNT = 8;

function generateBackupCodes() {
  return Array.from({ length: BACKUP_CODE_COUNT }, () => {
    const raw = randomBytes(4).toString('hex');
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  });
}

/** Checks a TOTP code, falling back to backup codes (consuming on match). */
async function checkAnyCode(userId, code) {
  const result = await pool.query(
    'SELECT secret, backup_codes FROM user_mfa WHERE user_id = $1 AND enabled = TRUE',
    [userId]
  );
  if (result.rowCount === 0) return false;
  const { secret, backup_codes: backupCodes } = result.rows[0];

  if (verifyCode(secret, code)) return true;

  // Backup code path — constant format, stored hashed, single-use.
  const hash = sha256(String(code).toLowerCase().trim());
  if (Array.isArray(backupCodes) && backupCodes.includes(hash)) {
    await pool.query(
      `UPDATE user_mfa SET backup_codes = backup_codes - $2 WHERE user_id = $1`,
      [userId, hash]
    );
    return true;
  }
  return false;
}

// ─── POST /api/auth/mfa/setup ────────────────────────────────────────────────

async function setup(req, res) {
  try {
    const enabled = await pool.query(
      'SELECT 1 FROM user_mfa WHERE user_id = $1 AND enabled = TRUE',
      [req.userId]
    );
    if (enabled.rowCount > 0) {
      return res.status(400).json({ error: '2FA is already enabled. Disable it first.' });
    }

    const user = await pool.query('SELECT email FROM users WHERE id = $1', [req.userId]);
    if (user.rowCount === 0) return res.status(404).json({ error: 'User not found.' });

    const secret = generateSecret();
    await pool.query(
      `INSERT INTO user_mfa (user_id, secret, enabled, backup_codes)
       VALUES ($1, $2, FALSE, '[]')
       ON CONFLICT (user_id) DO UPDATE SET secret = $2, enabled = FALSE, backup_codes = '[]'`,
      [req.userId, secret]
    );

    return res.json({
      secret,
      otpauth_uri: provisioningUri(secret, user.rows[0].email),
      message: 'Scan the URI, then confirm a code via /api/auth/mfa/enable.',
    });
  } catch (err) {
    console.error('mfa setup error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── POST /api/auth/mfa/enable ───────────────────────────────────────────────

async function enable(req, res) {
  const { code } = req.body;

  try {
    const result = await pool.query(
      'SELECT secret, enabled FROM user_mfa WHERE user_id = $1',
      [req.userId]
    );
    if (result.rowCount === 0) {
      return res.status(400).json({ error: 'Run /api/auth/mfa/setup first.' });
    }
    if (result.rows[0].enabled) {
      return res.status(400).json({ error: '2FA is already enabled.' });
    }
    if (!verifyCode(result.rows[0].secret, code)) {
      return res.status(401).json({ error: 'Invalid code.' });
    }

    const backupCodes = generateBackupCodes();
    await pool.query(
      'UPDATE user_mfa SET enabled = TRUE, backup_codes = $2 WHERE user_id = $1',
      [req.userId, JSON.stringify(backupCodes.map(sha256))]
    );

    return res.json({
      message: '2FA enabled.',
      backup_codes: backupCodes, // shown exactly once — store them safely
    });
  } catch (err) {
    console.error('mfa enable error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── POST /api/auth/mfa/disable ──────────────────────────────────────────────

async function disable(req, res) {
  const { code } = req.body;

  try {
    if (!(await checkAnyCode(req.userId, code))) {
      return res.status(401).json({ error: 'Invalid code.' });
    }
    await pool.query('DELETE FROM user_mfa WHERE user_id = $1', [req.userId]);
    return res.json({ message: '2FA disabled.' });
  } catch (err) {
    console.error('mfa disable error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── POST /api/auth/mfa/verify ───────────────────────────────────────────────
// Public: completes a login that returned { mfa_required, mfa_token }.

async function verify(req, res) {
  const { mfa_token: mfaToken, code } = req.body;
  if (!mfaToken || !code) {
    return res.status(400).json({ error: 'mfa_token and code are required.' });
  }

  try {
    let payload;
    try {
      payload = await verifyMfaToken(mfaToken);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired MFA token.' });
    }

    // One-time use — a replayed mfa_token is rejected even within its TTL.
    if (await sessions.isJtiRevoked(payload.jti)) {
      return res.status(401).json({ error: 'Invalid or expired MFA token.' });
    }

    if (!(await checkAnyCode(payload.sub, code))) {
      return res.status(401).json({ error: 'Invalid code.' });
    }

    await sessions.revokeJti(payload.jti, payload.exp);

    const user = await pool.query(
      'SELECT id, username, email FROM users WHERE id = $1',
      [payload.sub]
    );
    if (user.rowCount === 0) return res.status(401).json({ error: 'Account no longer exists.' });

    const token = await signIdentityToken(payload.sub);
    const { plaintext: refreshToken } = await sessions.issueRefreshToken(payload.sub);
    const { exp, iat } = decodeJwt(token);
    logEvent(EVENT.LOGIN_SUCCESS);

    return res.json({
      message: 'Login successful.',
      token,
      refresh_token: refreshToken,
      expires_in: exp - iat,
      user: user.rows[0],
    });
  } catch (err) {
    console.error('mfa verify error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

module.exports = { setup, enable, disable, verify };
