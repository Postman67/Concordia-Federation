const bcrypt   = require('bcrypt');
const { randomBytes, createHash } = require('crypto');
const { decodeJwt } = require('jose');
const pool     = require('../config/db');
const { logEvent, EVENT } = require('../metrics/events');
const { signIdentityToken, signServerToken, signMfaToken } = require('../services/tokens');
const sessions = require('../services/sessions');
const { sendEmail } = require('../services/mailer');

const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12;

// Lockout policy: 5 failures within 15 minutes locks the account for 15 minutes.
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_WINDOW_MIN = 15;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

function publicUrl() {
  return (process.env.PUBLIC_URL || 'https://federation.concordiachat.com').replace(/\/$/, '');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Mints the identity + refresh token pair returned by login/register/refresh. */
async function mintTokenPair(userId) {
  const token = await signIdentityToken(userId);
  const { plaintext: refreshToken } = await sessions.issueRefreshToken(userId);
  const { exp, iat } = decodeJwt(token);
  return { token, refresh_token: refreshToken, expires_in: exp - iat };
}

/** Returns true (and responds 429) if the account is currently locked. */
async function checkLockout(email, res) {
  const result = await pool.query(
    'SELECT locked_until FROM auth_failures WHERE email = $1 AND locked_until > NOW()',
    [email]
  );
  if (result.rowCount > 0) {
    res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
    return true;
  }
  return false;
}

/** Records a failed login and locks the account past the threshold. */
async function recordFailure(email) {
  await pool.query(
    `INSERT INTO auth_failures (email, fail_count, last_fail_at)
     VALUES ($1, 1, NOW())
     ON CONFLICT (email) DO UPDATE SET
       fail_count = CASE
         WHEN auth_failures.last_fail_at < NOW() - make_interval(mins => $2) THEN 1
         ELSE auth_failures.fail_count + 1
       END,
       last_fail_at = NOW(),
       locked_until = CASE
         WHEN (CASE
           WHEN auth_failures.last_fail_at < NOW() - make_interval(mins => $2) THEN 1
           ELSE auth_failures.fail_count + 1
         END) >= $3 THEN NOW() + make_interval(mins => $2)
         ELSE NULL
       END`,
    [email, LOCKOUT_WINDOW_MIN, LOCKOUT_THRESHOLD]
  );
}

async function clearFailures(email) {
  await pool.query('DELETE FROM auth_failures WHERE email = $1', [email]);
}

/** Creates a one-time email token and returns the plaintext for the link. */
async function createEmailToken(userId, purpose, ttlMinutes) {
  const plaintext = randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at)
     VALUES ($1, $2, $3, NOW() + make_interval(mins => $4))`,
    [sha256(plaintext), userId, purpose, ttlMinutes]
  );
  return plaintext;
}

async function sendVerificationEmail(userId, email, username) {
  const token = await createEmailToken(userId, 'verify', 24 * 60);
  const link = `${publicUrl()}/account/verify-email.html?token=${token}`;
  await sendEmail({
    to: email,
    subject: 'Verify your Concordia email',
    text: `Hi ${username},\n\nConfirm your email address for Concordia:\n${link}\n\nThis link expires in 24 hours. If you didn't create this account, ignore this email.`,
    html: `<p>Hi ${username},</p><p>Confirm your email address for Concordia:</p><p><a href="${link}">Verify email</a></p><p>This link expires in 24 hours. If you didn't create this account, ignore this email.</p>`,
  });
}

// ─── POST /api/auth/register ─────────────────────────────────────────────────

async function register(req, res) {
  const { username, email, password } = req.body;

  try {
    // Check for existing username or email in one query
    const existing = await pool.query(
      'SELECT id, username, email FROM users WHERE username = $1 OR email = $2 LIMIT 1',
      [username, email]
    );

    if (existing.rowCount > 0) {
      const taken = existing.rows[0];
      const field = taken.username === username ? 'username' : 'email';
      return res.status(409).json({ error: `That ${field} is already in use.` });
    }

    // Hash password — never store plaintext
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email, created_at`,
      [username, email, passwordHash]
    );

    const user = result.rows[0];
    const pair = await mintTokenPair(user.id);
    logEvent(EVENT.REGISTERED);

    // Best-effort — registration must not fail because email is down.
    sendVerificationEmail(user.id, user.email, user.username)
      .catch(err => console.error('verification email failed:', err.message));

    return res.status(201).json({
      message: 'Account created successfully.',
      ...pair,
      user: {
        id:         user.id,
        username:   user.username,
        email:      user.email,
        created_at: user.created_at,
      },
    });
  } catch (err) {
    console.error('register error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── POST /api/auth/login ────────────────────────────────────────────────────

async function login(req, res) {
  const { email, password } = req.body;

  try {
    if (await checkLockout(email, res)) return;

    const result = await pool.query(
      'SELECT id, username, email, password_hash FROM users WHERE email = $1 LIMIT 1',
      [email]
    );

    if (result.rowCount === 0) {
      // Use the same message for both "no account" and "wrong password" to
      // avoid leaking which emails are registered (user enumeration).
      // Failures are recorded for unknown emails too, for the same reason.
      await recordFailure(email);
      logEvent(EVENT.LOGIN_FAIL);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = result.rows[0];

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      await recordFailure(email);
      logEvent(EVENT.LOGIN_FAIL);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    await clearFailures(email);

    // TOTP 2FA: password alone doesn't finish login — hand back a 5-minute
    // MFA token that only /api/auth/mfa/verify accepts.
    const mfa = await pool.query(
      'SELECT 1 FROM user_mfa WHERE user_id = $1 AND enabled = TRUE',
      [user.id]
    );
    if (mfa.rowCount > 0) {
      const mfaToken = await signMfaToken(user.id);
      return res.status(200).json({ mfa_required: true, mfa_token: mfaToken });
    }

    const pair = await mintTokenPair(user.id);
    logEvent(EVENT.LOGIN_SUCCESS);

    return res.status(200).json({
      message: 'Login successful.',
      ...pair,
      user: {
        id:       user.id,
        username: user.username,
        email:    user.email,
      },
    });
  } catch (err) {
    console.error('login error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── POST /api/auth/refresh ──────────────────────────────────────────────────
// Rotating refresh: the presented token is revoked and replaced. Reuse of an
// already-rotated token nukes the whole family (stolen-token defense).

async function refresh(req, res) {
  const { refresh_token: presented } = req.body;
  if (!presented) return res.status(400).json({ error: 'refresh_token is required.' });

  try {
    const { userId, plaintext } = await sessions.rotateRefreshToken(presented);

    // The account may have been deleted since the token was issued.
    const user = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (user.rowCount === 0) return res.status(401).json({ error: 'Account no longer exists.' });

    const token = await signIdentityToken(userId);
    const { exp, iat } = decodeJwt(token);
    return res.json({ token, refresh_token: plaintext, expires_in: exp - iat });
  } catch (err) {
    if (err instanceof sessions.RefreshReuseError) {
      return res.status(401).json({ error: 'Session revoked. Please log in again.' });
    }
    if (err instanceof sessions.InvalidRefreshError) {
      return res.status(401).json({ error: 'Invalid or expired refresh token.' });
    }
    console.error('refresh error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── POST /api/auth/logout ───────────────────────────────────────────────────
// Real logout: blacklists the presented identity token's jti and revokes the
// refresh token (if provided). No more client-side theater.

async function logout(req, res) {
  try {
    const { jti, exp } = req.tokenPayload || {};
    if (jti && exp) await sessions.revokeJti(jti, exp);
    if (req.body?.refresh_token) await sessions.revokeRefreshToken(req.body.refresh_token);
    return res.json({ message: 'Logged out.' });
  } catch (err) {
    console.error('logout error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── POST /api/auth/server-token ─────────────────────────────────────────────
// OAuth-style token exchange: trades the caller's identity token (validated
// by requireAuth) for a short-lived token scoped to ONE chat server.
// The identity token itself must never be sent to a chat server — servers
// only ever see tokens whose `aud` is their own origin.

async function serverToken(req, res) {
  const { server } = req.body;

  try {
    // Embed the user's display basics so servers render members without
    // calling back into the Federation.
    const result = await pool.query(
      `SELECT u.username, s.avatar_url
       FROM users u
       LEFT JOIN user_settings s ON s.user_id = u.id
       WHERE u.id = $1`,
      [req.userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const { token, audience, expiresIn } = await signServerToken(
      req.userId,
      server,
      result.rows[0]
    );

    return res.json({ token, audience, expires_in: expiresIn });
  } catch (err) {
    if (err instanceof TypeError || /Server address/.test(err.message)) {
      return res.status(400).json({ error: 'Invalid server address.' });
    }
    console.error('serverToken error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── POST /api/auth/verify-email/request ────────────────────────────────────

async function requestEmailVerify(req, res) {
  try {
    const result = await pool.query(
      'SELECT email, username, email_verified FROM users WHERE id = $1',
      [req.userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found.' });

    const user = result.rows[0];
    if (user.email_verified) {
      return res.status(400).json({ error: 'Email is already verified.' });
    }

    await sendVerificationEmail(req.userId, user.email, user.username);
    return res.json({ message: 'Verification email sent.' });
  } catch (err) {
    console.error('requestEmailVerify error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── POST /api/auth/verify-email/confirm ────────────────────────────────────

async function confirmEmailVerify(req, res) {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token is required.' });

  try {
    const result = await pool.query(
      `UPDATE email_tokens SET used_at = NOW()
       WHERE token_hash = $1 AND purpose = 'verify'
         AND used_at IS NULL AND expires_at > NOW()
       RETURNING user_id`,
      [sha256(token)]
    );
    if (result.rowCount === 0) {
      return res.status(400).json({ error: 'Invalid or expired verification link.' });
    }

    await pool.query('UPDATE users SET email_verified = TRUE WHERE id = $1', [
      result.rows[0].user_id,
    ]);
    return res.json({ message: 'Email verified.' });
  } catch (err) {
    console.error('confirmEmailVerify error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── POST /api/auth/password-reset/request ──────────────────────────────────
// Always responds 200 so the endpoint can't be used for user enumeration.

async function requestPasswordReset(req, res) {
  const { email } = req.body;
  const genericResponse = { message: 'If that email has an account, a reset link is on its way.' };

  try {
    const result = await pool.query(
      'SELECT id, username FROM users WHERE email = $1 LIMIT 1',
      [email]
    );

    if (result.rowCount > 0) {
      const user = result.rows[0];
      const token = await createEmailToken(user.id, 'reset', 60);
      const link = `${publicUrl()}/account/reset-password.html?token=${token}`;
      await sendEmail({
        to: email,
        subject: 'Reset your Concordia password',
        text: `Hi ${user.username},\n\nReset your Concordia password:\n${link}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email — your password is unchanged.`,
        html: `<p>Hi ${user.username},</p><p>Reset your Concordia password:</p><p><a href="${link}">Reset password</a></p><p>This link expires in 1 hour. If you didn't request this, ignore this email — your password is unchanged.</p>`,
      });
    }

    return res.json(genericResponse);
  } catch (err) {
    console.error('requestPasswordReset error:', err.message);
    // Still generic — never leak state through error behavior.
    return res.json(genericResponse);
  }
}

// ─── POST /api/auth/password-reset/confirm ──────────────────────────────────

async function confirmPasswordReset(req, res) {
  const { token, password } = req.body;
  if (!token) return res.status(400).json({ error: 'Token is required.' });

  try {
    const result = await pool.query(
      `UPDATE email_tokens SET used_at = NOW()
       WHERE token_hash = $1 AND purpose = 'reset'
         AND used_at IS NULL AND expires_at > NOW()
       RETURNING user_id`,
      [sha256(token)]
    );
    if (result.rowCount === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset link.' });
    }

    const userId = result.rows[0].user_id;
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const updated = await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING email',
      [passwordHash, userId]
    );

    // A reset invalidates every open session for the account.
    await sessions.revokeAllForUser(userId);
    if (updated.rowCount > 0) await clearFailures(updated.rows[0].email);

    return res.json({ message: 'Password updated. Please log in.' });
  } catch (err) {
    console.error('confirmPasswordReset error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  serverToken,
  requestEmailVerify,
  confirmEmailVerify,
  requestPasswordReset,
  confirmPasswordReset,
};
