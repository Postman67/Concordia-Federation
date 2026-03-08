const pool = require('../config/db');
const { emitStatusChange } = require('../socket/emitter');

const VALID_STATUSES = ['online', 'idle', 'dnd', 'invisible', 'offline'];

const DURATION_MAP = {
  '15m': 15 * 60 * 1000,
  '1h':  60 * 60 * 1000,
  '8h':  8  * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '48h': 48 * 60 * 60 * 1000,
  '3d':  3  * 24 * 60 * 60 * 1000,
};

function resolveExpiry(duration) {
  if (!duration || duration === 'never') return null;
  const ms = DURATION_MAP[duration];
  return ms ? new Date(Date.now() + ms) : null;
}

// GET /api/user/me
async function getMe(req, res) {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.email, u.created_at,
              s.display_name, s.avatar_url, s.banner_url, s.bio, s.profile_link,
              s.theme, s.status, s.last_seen,
              CASE WHEN s.custom_status_expires_at IS NULL OR s.custom_status_expires_at > NOW()
                   THEN s.custom_status ELSE NULL
              END AS custom_status,
              CASE WHEN s.custom_status_expires_at IS NULL OR s.custom_status_expires_at > NOW()
                   THEN s.custom_status_expires_at ELSE NULL
              END AS custom_status_expires_at
       FROM users u
       LEFT JOIN user_settings s ON s.user_id = u.id
       WHERE u.id = $1`,
      [req.userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    return res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('getMe error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// PUT /api/user/status  — set my own status
async function setStatus(req, res) {
  const { status, custom_status, custom_status_duration } = req.body;

  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${VALID_STATUSES.join(', ')}.` });
  }

  if (custom_status !== undefined && custom_status !== null && custom_status.length > 100) {
    return res.status(400).json({ error: 'custom_status must be 100 characters or fewer.' });
  }

  // Compute expiry timestamp; clearing custom_status also clears expiry
  const isClearing = custom_status === '' || custom_status === null;
  const expiresAt = isClearing ? null : resolveExpiry(custom_status_duration);

  try {
    await pool.query(
      `INSERT INTO user_settings (user_id, status, last_seen, custom_status, custom_status_expires_at)
       VALUES ($1, $2, NOW(), $3, $4)
       ON CONFLICT (user_id) DO UPDATE
         SET status                   = EXCLUDED.status,
             last_seen                = NOW(),
             custom_status            = CASE
               WHEN EXCLUDED.custom_status IS NULL AND EXCLUDED.custom_status_expires_at IS NULL
               THEN user_settings.custom_status
               ELSE EXCLUDED.custom_status
             END,
             custom_status_expires_at = CASE
               WHEN EXCLUDED.custom_status IS NULL AND EXCLUDED.custom_status_expires_at IS NULL
               THEN user_settings.custom_status_expires_at
               ELSE EXCLUDED.custom_status_expires_at
             END,
             updated_at               = NOW()`,
      [req.userId, status, isClearing ? null : (custom_status ?? null), isClearing ? null : expiresAt]
    );

    emitStatusChange(req.userId, status, isClearing ? null : (custom_status ?? null), isClearing ? null : expiresAt);
    return res.json({
      status,
      custom_status: isClearing ? null : (custom_status ?? null),
      custom_status_expires_at: isClearing ? null : expiresAt,
    });
  } catch (err) {
    console.error('setStatus error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// POST /api/user/heartbeat  — refresh last_seen; auto-set online if currently offline
async function heartbeat(req, res) {
  try {
    await pool.query(
      `INSERT INTO user_settings (user_id, status, last_seen)
       VALUES ($1, 'online', NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET last_seen  = NOW(),
             status     = CASE
                            WHEN user_settings.status = 'offline' THEN 'online'
                            ELSE user_settings.status
                          END,
             updated_at = NOW()`,
      [req.userId]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('heartbeat error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// GET /api/user/status/:id  — get another user's visible status (invisible → offline)
async function getStatus(req, res) {
  try {
    const result = await pool.query(
      `SELECT s.status, s.last_seen,
              CASE WHEN s.custom_status_expires_at IS NULL OR s.custom_status_expires_at > NOW()
                   THEN s.custom_status ELSE NULL
              END AS custom_status,
              CASE WHEN s.custom_status_expires_at IS NULL OR s.custom_status_expires_at > NOW()
                   THEN s.custom_status_expires_at ELSE NULL
              END AS custom_status_expires_at
       FROM user_settings s
       WHERE s.user_id = $1`,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const { status, last_seen, custom_status, custom_status_expires_at } = result.rows[0];
    const visible_status = status === 'invisible' ? 'offline' : status;

    return res.json({ status: visible_status, custom_status, custom_status_expires_at, last_seen });
  } catch (err) {
    console.error('getStatus error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

module.exports = { getMe, setStatus, heartbeat, getStatus };
