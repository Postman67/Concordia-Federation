const pool = require('../config/db');
const { emitSettingsSync } = require('../socket/emitter');

// GET /api/settings
async function getSettings(req, res) {
  try {
    const result = await pool.query(
      'SELECT display_name, avatar_url, theme, updated_at FROM user_settings WHERE user_id = $1',
      [req.userId]
    );

    // Return defaults if settings row doesn't exist yet
    const settings = result.rows[0] ?? { display_name: null, avatar_url: null, theme: 'dark' };
    return res.json({ settings });
  } catch (err) {
    console.error('getSettings error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// PUT /api/settings
async function updateSettings(req, res) {
  const { display_name, avatar_url, theme } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO user_settings (user_id, display_name, avatar_url, theme)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE
         SET display_name = COALESCE(EXCLUDED.display_name, user_settings.display_name),
             avatar_url   = COALESCE(EXCLUDED.avatar_url,   user_settings.avatar_url),
             theme        = COALESCE(EXCLUDED.theme,        user_settings.theme),
             updated_at   = NOW()
       RETURNING display_name, avatar_url, theme, updated_at`,
      [req.userId, display_name ?? null, avatar_url ?? null, theme ?? null]
    );

    // Push updated settings to all the user's other open sessions
    emitSettingsSync(req.userId, result.rows[0]);
    return res.json({ settings: result.rows[0] });
  } catch (err) {
    console.error('updateSettings error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

module.exports = { getSettings, updateSettings };
