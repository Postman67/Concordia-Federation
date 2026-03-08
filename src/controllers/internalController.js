const pool = require('../config/db');

// Shared profile columns used by both endpoints
const PROFILE_SELECT = `
  SELECT  u.id,
          u.username,
          s.display_name,
          s.avatar_url,
          s.banner_url,
          s.bio,
          s.status,
          s.profile_link
  FROM    users         u
  LEFT JOIN user_settings s ON s.user_id = u.id`;

// GET /api/internal/users/search?q=<prefix>
// Returns up to 25 users whose username begins with the query string.
async function searchUsers(req, res) {
  const q = (req.query.q || '').trim();
  if (!q) {
    return res.status(400).json({ error: 'Query parameter "q" is required.' });
  }

  try {
    const result = await pool.query(
      `${PROFILE_SELECT}
       WHERE u.username ILIKE $1
       ORDER BY u.username
       LIMIT 25`,
      [q + '%']
    );
    return res.json({ users: result.rows });
  } catch (err) {
    console.error('internal searchUsers error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// GET /api/internal/users/:id
// Returns the full public profile for a single user by UUID.
async function getUserById(req, res) {
  try {
    const result = await pool.query(
      `${PROFILE_SELECT}
       WHERE u.id = $1`,
      [req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    return res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('internal getUserById error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

module.exports = { searchUsers, getUserById };
