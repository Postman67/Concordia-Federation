const pool = require('../config/db');

// GET /api/admin/users — list all users with stats
async function listUsers(req, res) {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.email, u.created_at,
              s.display_name, s.avatar_url, s.theme,
              COUNT(srv.id) AS server_count
       FROM users u
       LEFT JOIN user_settings s   ON s.user_id = u.id
       LEFT JOIN user_servers  srv ON srv.user_id = u.id
       GROUP BY u.id, s.display_name, s.avatar_url, s.theme
       ORDER BY u.created_at DESC`
    );
    return res.json({ users: result.rows });
  } catch (err) {
    console.error('admin listUsers error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// GET /api/admin/users/:id — single user detail
async function getUser(req, res) {
  try {
    const userResult = await pool.query(
      `SELECT u.id, u.username, u.email, u.created_at, u.updated_at,
              s.display_name, s.avatar_url, s.theme
       FROM users u
       LEFT JOIN user_settings s ON s.user_id = u.id
       WHERE u.id = $1`,
      [req.params.id]
    );
    if (userResult.rowCount === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const serversResult = await pool.query(
      'SELECT id, server_address, server_name, position, added_at FROM user_servers WHERE user_id = $1 ORDER BY position ASC',
      [req.params.id]
    );

    return res.json({ user: userResult.rows[0], servers: serversResult.rows });
  } catch (err) {
    console.error('admin getUser error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// PATCH /api/admin/users/:id — update username, email, or settings
async function updateUser(req, res) {
  const { username, email, display_name, avatar_url, theme } = req.body;

  try {
    if (username || email) {
      await pool.query(
        `UPDATE users
         SET username   = COALESCE($1, username),
             email      = COALESCE($2, email),
             updated_at = NOW()
         WHERE id = $3`,
        [username ?? null, email ?? null, req.params.id]
      );
    }

    if (display_name !== undefined || avatar_url !== undefined || theme !== undefined) {
      await pool.query(
        `INSERT INTO user_settings (user_id, display_name, avatar_url, theme)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE
           SET display_name = COALESCE(EXCLUDED.display_name, user_settings.display_name),
               avatar_url   = COALESCE(EXCLUDED.avatar_url,   user_settings.avatar_url),
               theme        = COALESCE(EXCLUDED.theme,        user_settings.theme),
               updated_at   = NOW()`,
        [req.params.id, display_name ?? null, avatar_url ?? null, theme ?? null]
      );
    }

    // Return fresh user snapshot
    const result = await pool.query(
      `SELECT u.id, u.username, u.email, u.created_at, u.updated_at,
              s.display_name, s.avatar_url, s.theme
       FROM users u
       LEFT JOIN user_settings s ON s.user_id = u.id
       WHERE u.id = $1`,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    return res.json({ user: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username or email already in use.' });
    }
    console.error('admin updateUser error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// DELETE /api/admin/users/:id — delete a user and all their data (cascade)
async function deleteUser(req, res) {
  if (req.params.id === process.env.ADMIN_UUID) {
    return res.status(400).json({ error: 'Cannot delete the master admin account.' });
  }

  try {
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    return res.status(204).send();
  } catch (err) {
    console.error('admin deleteUser error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// GET /api/admin/stats — federation-wide stats
async function getStats(req, res) {
  try {
    const result = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM users)        AS total_users,
         (SELECT COUNT(*) FROM user_servers) AS total_server_entries,
         (SELECT COUNT(DISTINCT server_address) FROM user_servers) AS unique_servers`
    );
    return res.json({ stats: result.rows[0] });
  } catch (err) {
    console.error('admin getStats error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

module.exports = { listUsers, getUser, updateUser, deleteUser, getStats };
