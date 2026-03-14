const pool = require('../config/db');
const { emitSessionRevoked, emitAccountUpdated, emitAdminNotice } = require('../socket/emitter');
const { getIO, getSessionStats, getActiveSessions } = require('../socket/index');
const { getStats: getRtStats } = require('../metrics/responseTime');

// GET /api/admin/users — list all users with stats
async function listUsers(req, res) {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.email, u.created_at,
              s.display_name, s.avatar_url, s.theme, s.status, s.last_seen,
              COUNT(srv.id) AS server_count
       FROM users u
       LEFT JOIN user_settings s   ON s.user_id = u.id
       LEFT JOIN user_servers  srv ON srv.user_id = u.id
       GROUP BY u.id, s.display_name, s.avatar_url, s.theme, s.status, s.last_seen
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
              s.display_name, s.avatar_url, s.theme, s.status, s.last_seen
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
  const { username, email, display_name, avatar_url, theme, status } = req.body;

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

    if (display_name !== undefined || avatar_url !== undefined || theme !== undefined || status !== undefined) {
      await pool.query(
        `INSERT INTO user_settings (user_id, display_name, avatar_url, theme, status)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id) DO UPDATE
           SET display_name = COALESCE(EXCLUDED.display_name, user_settings.display_name),
               avatar_url   = COALESCE(EXCLUDED.avatar_url,   user_settings.avatar_url),
               theme        = COALESCE(EXCLUDED.theme,        user_settings.theme),
               status       = COALESCE(EXCLUDED.status,       user_settings.status),
               updated_at   = NOW()`,
        [req.params.id, display_name ?? null, avatar_url ?? null, theme ?? null, status ?? null]
      );
    }

    // Return fresh user snapshot
    const result = await pool.query(
      `SELECT u.id, u.username, u.email, u.created_at, u.updated_at,
              s.display_name, s.avatar_url, s.theme, s.status, s.last_seen
       FROM users u
       LEFT JOIN user_settings s ON s.user_id = u.id
       WHERE u.id = $1`,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    // Notify the user's connected sessions so their clients re-fetch /api/user/me
    emitAccountUpdated(req.params.id, result.rows[0]);
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
    // Kick all active sessions before the DB row is gone
    emitSessionRevoked(req.params.id);
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

// POST /api/admin/notice — broadcast a federation-wide notice to all connected clients
function broadcastNotice(req, res) {
  const { message, severity = 'info' } = req.body;
  emitAdminNotice(message, severity);
  return res.json({ ok: true, message, severity });
}

// GET /api/admin/metrics — live snapshot of all federation metrics
async function getMetrics(req, res) {
  // Prune events older than 90 days on every fetch (fire-and-forget)
  pool.query("DELETE FROM federation_events WHERE occurred_at < NOW() - INTERVAL '90 days'")
    .catch(e => console.error('metrics prune:', e.message));

  try {
    const [liveResult, lifetimeResult, statusResult] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM user_settings
            WHERE last_seen > NOW() - INTERVAL '24 hours')::int AS dau,
          (SELECT COUNT(*) FROM user_settings
            WHERE last_seen > NOW() - INTERVAL '7 days')::int   AS wau,
          (SELECT ROUND(AVG(cnt)::numeric, 1)::text
           FROM (
             SELECT COUNT(srv.id) AS cnt
             FROM users u LEFT JOIN user_servers srv ON srv.user_id = u.id
             GROUP BY u.id
           ) t) AS avg_servers_per_user
      `),
      pool.query('SELECT key, value FROM federation_counters'),
      pool.query(`
        SELECT COALESCE(status, 'offline') AS status, COUNT(*)::int AS count
        FROM user_settings GROUP BY status
      `),
    ]);

    const live = liveResult.rows[0];

    const lifetime = {};
    for (const row of lifetimeResult.rows) lifetime[row.key] = parseInt(row.value, 10);

    const statusDist = {};
    for (const row of statusResult.rows) statusDist[row.status] = row.count;

    const mem = process.memoryUsage();
    const sessionSnap = getSessionStats();

    return res.json({
      metrics: {
        active_connections:   sessionSnap.total_sockets,
        unique_users_online:  sessionSnap.unique_users,
        sessions_by_platform: sessionSnap.by_platform,
        dau:                  live.dau  ?? 0,
        wau:                  live.wau  ?? 0,
        avg_servers_per_user: live.avg_servers_per_user ?? '0.0',
        status_distribution:  statusDist,
        db_pool: {
          total:   pool.totalCount   ?? null,
          idle:    pool.idleCount    ?? null,
          waiting: pool.waitingCount ?? null,
        },
        uptime_seconds: Math.floor(process.uptime()),
        memory_mb: {
          rss:        Math.round(mem.rss        / 1024 / 1024),
          heap_used:  Math.round(mem.heapUsed   / 1024 / 1024),
          heap_total: Math.round(mem.heapTotal  / 1024 / 1024),
        },
        lifetime,
        avg_response_ms: getRtStats(),
      },
    });
  } catch (err) {
    console.error('admin getMetrics error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// GET /api/admin/metrics/history — per-day event counts (default 7 days, max 90)
async function getMetricsHistory(req, res) {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
  try {
    const result = await pool.query(
      `SELECT
         DATE(occurred_at AT TIME ZONE 'UTC') AS date,
         event_type,
         COUNT(*)::int                        AS count
       FROM federation_events
       WHERE occurred_at > NOW() - ($1::int * INTERVAL '1 day')
       GROUP BY date, event_type
       ORDER BY date ASC`,
      [days]
    );

    // Pivot rows into { date, login_success, login_fail, user_registered }
    const byDate = {};
    for (const row of result.rows) {
      if (!byDate[row.date]) {
        byDate[row.date] = { date: row.date, login_success: 0, login_fail: 0, user_registered: 0 };
      }
      byDate[row.date][row.event_type] = row.count;
    }

    // Fill every UTC day in the range so the client always gets a full array
    const history = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      history.push(byDate[key] ?? { date: key, login_success: 0, login_fail: 0, user_registered: 0 });
    }

    return res.json({ history });
  } catch (err) {
    console.error('admin getMetricsHistory error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// GET /api/admin/sessions — snapshot of all currently active WebSocket sessions
function listActiveSessions(req, res) {
  const activeSessions = getActiveSessions();
  return res.json({ sessions: activeSessions, count: activeSessions.length });
}

module.exports = { listUsers, getUser, updateUser, deleteUser, getStats, broadcastNotice, getMetrics, getMetricsHistory, listActiveSessions };
