const pool = require('../config/db');

// GET /api/servers
async function getServers(req, res) {
  try {
    const result = await pool.query(
      'SELECT id, server_address, nickname, position, added_at FROM user_servers WHERE user_id = $1 ORDER BY position ASC, added_at ASC',
      [req.userId]
    );
    return res.json({ servers: result.rows });
  } catch (err) {
    console.error('getServers error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// POST /api/servers
async function addServer(req, res) {
  const { server_address, nickname } = req.body;

  try {
    // Place new server at the end of the list
    const posResult = await pool.query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM user_servers WHERE user_id = $1',
      [req.userId]
    );
    const position = posResult.rows[0].next_pos;

    const result = await pool.query(
      `INSERT INTO user_servers (user_id, server_address, nickname, position)
       VALUES ($1, $2, $3, $4)
       RETURNING id, server_address, nickname, position, added_at`,
      [req.userId, server_address, nickname ?? null, position]
    );

    return res.status(201).json({ server: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'That server is already in your list.' });
    }
    console.error('addServer error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// PATCH /api/servers/:id  — update nickname or position
async function updateServer(req, res) {
  const { id } = req.params;
  const { nickname, position } = req.body;

  try {
    const result = await pool.query(
      `UPDATE user_servers
       SET nickname = COALESCE($1, nickname),
           position = COALESCE($2, position)
       WHERE id = $3 AND user_id = $4
       RETURNING id, server_address, nickname, position, added_at`,
      [nickname ?? null, position ?? null, id, req.userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Server not found.' });
    }
    return res.json({ server: result.rows[0] });
  } catch (err) {
    console.error('updateServer error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// DELETE /api/servers/:id
async function removeServer(req, res) {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM user_servers WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Server not found.' });
    }
    return res.status(204).send();
  } catch (err) {
    console.error('removeServer error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

module.exports = { getServers, addServer, updateServer, removeServer };
