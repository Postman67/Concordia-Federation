const pool = require('../config/db');

// GET /api/user/me
async function getMe(req, res) {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.email, u.created_at,
              s.display_name, s.avatar_url, s.theme
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

module.exports = { getMe };
