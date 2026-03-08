const pool = require('../config/db');
const { emitStatusChange } = require('../socket/emitter');

const VALID_STATUSES = ['online', 'idle', 'dnd', 'invisible', 'offline'];

// GET /api/user/me
async function getMe(req, res) {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.email, u.created_at,
              s.display_name, s.avatar_url, s.theme, s.status, s.last_seen
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
  const { status } = req.body;

  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${VALID_STATUSES.join(', ')}.` });
  }

  try {
    await pool.query(
      `INSERT INTO user_settings (user_id, status, last_seen)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET status    = EXCLUDED.status,
             last_seen = NOW(),
             updated_at = NOW()`,
      [req.userId, status]
    );
    // Broadcast to all connected clients so status indicators update instantly
    emitStatusChange(req.userId, status);
    return res.json({ status });
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
      `SELECT s.status, s.last_seen
       FROM user_settings s
       WHERE s.user_id = $1`,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const { status, last_seen } = result.rows[0];
    // Invisible users appear offline to everyone else
    const visible_status = status === 'invisible' ? 'offline' : status;

    return res.json({ status: visible_status, last_seen });
  } catch (err) {
    console.error('getStatus error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

module.exports = { getMe, setStatus, heartbeat, getStatus };
