/**
 * Federation WebSocket Server (Socket.io)
 *
 * Each authenticated client joins two rooms on connect:
 *  - `user:<userId>`  — events targeted at that specific user across all their sessions
 *  - `presence`       — every connected socket; used for broadcasting status changes
 *
 * Events emitted by the server
 * ─────────────────────────────────────────────────────────────────────────────
 * status_change     → presence room
 *   { userId, status }
 *   Sent when any user updates their status. Invisible users emit `offline`
 *   so the real status is never leaked to other clients.
 *
 * settings_sync     → user:<userId> room (all your sessions except the sender)
 *   { display_name, avatar_url, theme, updated_at }
 *   Sent when a user updates their global settings so all open clients update.
 *
 * server_list_sync  → user:<userId> room (all your sessions except the sender)
 *   { servers: [...] }
 *   Sent when a server is added, updated, or removed from the user's list.
 *
 * heartbeat_ack     → requesting socket only
 *   { server_time }
 *   Confirms a heartbeat ping and returns the server's current UTC time for
 *   clock-skew detection.
 *
 * session_revoked   → user:<userId> room
 *   { reason }
 *   Sent when an admin deletes a user account. Clients should clear local
 *   state and redirect to the login screen immediately.
 *
 * account_updated   → user:<userId> room
 *   { user: { ... } }
 *   Sent when an admin edits a user's account so their clients can re-fetch
 *   the latest profile without polling.
 *
 * admin_notice      → presence room (all connected clients)
 *   { message, severity }
 *   Federation-wide broadcast from the admin panel (e.g. maintenance warning).
 *
 * Handshake auth fields
 * ─────────────────────────────────────────────────────────────────────────────
 * token     (required) JWT issued by /api/auth/login or /api/auth/register.
 * platform  (optional) Client platform: 'desktop' | 'web' | 'mobile_web'.
 *                      Defaults to 'web' if absent or unrecognised.
 *
 * Events emitted by the server
 * ─────────────────────────────────────────────────────────────────────────────
 * status_change     → presence room
 *   { userId, status, custom_status, custom_status_expires_at }
 *   Sent when any user updates their status, or when their last session
 *   disconnects (status becomes 'offline'). Invisible users always emit
 *   'offline' so the real status is never leaked to other clients.
 *
 * settings_sync     → user:<userId> room (all your sessions except the sender)
 *   { display_name, avatar_url, theme, updated_at }
 *
 * server_list_sync  → user:<userId> room (all your sessions except the sender)
 *   { servers: [...] }
 *
 * heartbeat_ack     → requesting socket only
 *   { server_time }
 *
 * session_revoked   → user:<userId> room
 *   { reason }
 *
 * account_updated   → user:<userId> room
 *   { user: { ... } }
 *
 * admin_notice      → presence room (all connected clients)
 *   { message, severity }
 *
 * Events received from clients
 * ─────────────────────────────────────────────────────────────────────────────
 * ping              → server replies with heartbeat_ack
 *   No payload required.
 */

const { Server } = require('socket.io');
const pool       = require('../config/db');
const { verifyIdentityToken } = require('../services/tokens');
const { isJtiRevoked } = require('../services/sessions');

let io = null;

const VALID_PLATFORMS  = ['desktop', 'web', 'mobile_web'];

/**
 * Grace period before writing offline to DB after a user's last session
 * disconnects. Absorbs browser page reloads and brief network drops without
 * flapping presence to offline and back.
 */
const OFFLINE_GRACE_MS = 8000;

/**
 * Active session registry.
 * Map<userId, Map<socketId, { platform: string, connectedAt: Date }>>
 */
const sessions = new Map();

/**
 * Pending offline timers keyed by userId.
 * Cancelled if the user opens a new socket within OFFLINE_GRACE_MS.
 */
const offlineTimers = new Map();

/**
 * Initialise the Socket.io server and attach it to an existing http.Server.
 * Called once from app.js.
 */
function init(httpServer) {
  // Same allowlist as the HTTP layer (CORS_ORIGINS, comma-separated).
  const corsOrigins = (process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

  io = new Server(httpServer, {
    cors: {
      origin: corsOrigins.length > 0 ? corsOrigins : '*',
      methods: ['GET', 'POST'],
    },
    // Keep connection alive — clients should ping every 25 s
    pingTimeout:   60000,
    pingInterval:  25000,
  });

  // ── JWT authentication middleware ─────────────────────────────────────────
  // Clients pass their JWT as the `auth.token` handshake parameter:
  //   const socket = io('https://federation.concordiachat.com', {
  //     auth: { token: '<jwt>' }
  //   });
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication required.'));
    }
    try {
      const payload = await verifyIdentityToken(token);
      if (await isJtiRevoked(payload.jti)) {
        return next(new Error('Invalid or expired token.'));
      }
      socket.userId = payload.sub;   // UUID string
      next();
    } catch {
      next(new Error('Invalid or expired token.'));
    }
  });

  // ── Connection handler ────────────────────────────────────────────────────
  io.on('connection', async (socket) => {
    const { userId } = socket;

    // ── Platform resolution ───────────────────────────────────────────────
    const rawPlatform = socket.handshake.auth?.platform;
    socket.platform = VALID_PLATFORMS.includes(rawPlatform) ? rawPlatform : 'web';

    // ── Session registry ──────────────────────────────────────────────────
    // Username placeholder (userId) — replaced after DB lookup below.
    if (!sessions.has(userId)) sessions.set(userId, new Map());
    sessions.get(userId).set(socket.id, {
      platform:    socket.platform,
      connectedAt: new Date(),
      username:    userId,
    });

    // Cancel any pending offline timer — user reconnected within grace period
    if (offlineTimers.has(userId)) {
      clearTimeout(offlineTimers.get(userId));
      offlineTimers.delete(userId);
    }

    // Join the user's personal room and the global presence room
    socket.join(`user:${userId}`);
    socket.join('presence');

    // Admin dashboard gets a dedicated room for real-time session push
    if (userId === process.env.ADMIN_UUID) socket.join('admin');

    console.log(`[WS] connected  userId=${userId} socketId=${socket.id} platform=${socket.platform}`);

    // ── ping → heartbeat_ack ──────────────────────────────────────────────
    // Clients send `ping` on their heartbeat interval; we reply with server
    // time so they can detect clock skew and confirm the socket is alive.
    // A missed heartbeat will trigger Socket.IO's built-in pingTimeout
    // disconnect, which then triggers the offline grace-period logic below.
    socket.on('ping', (payload) => {
      // Echo client_sent_at so the receiver can compute RTT-corrected clock skew:
      //   rtt   = Date.now() - client_sent_at
      //   skew  = server_time - (client_sent_at + rtt / 2)
      socket.emit('heartbeat_ack', {
        server_time:    new Date().toISOString(),
        client_sent_at: payload?.sent_at ?? null,
      });
    });

    // ── Disconnect ────────────────────────────────────────────────────────
    // Fires on clean tab close, navigation away, or heartbeat timeout.
    // If this is the user's last open socket we start a grace-period timer
    // before writing offline to the DB — this absorbs page reloads and
    // brief network blips without flapping presence.
    socket.on('disconnect', (reason) => {
      console.log(`[WS] disconnected userId=${userId} socketId=${socket.id} reason=${reason}`);

      const userSessions = sessions.get(userId);
      if (userSessions) {
        userSessions.delete(socket.id);

        // Notify admin dashboard immediately when a session drops
        pushPresenceToAdmin();

        if (userSessions.size === 0) {
          sessions.delete(userId);

          const timer = setTimeout(async () => {
            offlineTimers.delete(userId);
            if (sessions.has(userId)) return; // reconnected during grace period

            try {
              await pool.query(
                `UPDATE user_settings
                 SET status = 'offline', last_seen = NOW()
                 WHERE user_id = $1`,
                [userId]
              );
              if (io) {
                io.to('presence').emit('status_change', {
                  userId,
                  status:                   'offline',
                  custom_status:            null,
                  custom_status_expires_at: null,
                });
              }
            } catch (err) {
              console.error(`[WS] offline update failed userId=${userId}:`, err.message);
            }
          }, OFFLINE_GRACE_MS);

          offlineTimers.set(userId, timer);
        }
      }
    });

    // ── Resolve username from DB ──────────────────────────────────────────
    // Registered after all sync event listeners to avoid a race where a
    // disconnect fires before the await resumes and the handler is missing.
    try {
      const uRow = await pool.query('SELECT username FROM users WHERE id = $1', [userId]);
      const uname = uRow.rows[0]?.username || userId;
      const entry = sessions.get(userId)?.get(socket.id);
      if (entry) entry.username = uname;
    } catch { /* userId placeholder remains on DB error */ }

    // Push updated session list to admin dashboard (username now resolved)
    pushPresenceToAdmin();
  });

  // Push lightweight system metrics to admin dashboard every 10 s (no DB queries)
  setInterval(() => {
    if (!io) return;
    const mem = process.memoryUsage();
    io.to('admin').emit('admin_system_update', {
      uptime_seconds: Math.floor(process.uptime()),
      memory_mb: {
        rss:        Math.round(mem.rss        / 1024 / 1024),
        heap_used:  Math.round(mem.heapUsed   / 1024 / 1024),
        heap_total: Math.round(mem.heapTotal  / 1024 / 1024),
      },
      db_pool: {
        total:   pool.totalCount   ?? null,
        idle:    pool.idleCount    ?? null,
        waiting: pool.waitingCount ?? null,
      },
    });
  }, 10000);

  console.log('[WS] Socket.io server initialised.');
  return io;
}

/** Return the shared io instance (throws if called before init). */
function getIO() {
  if (!io) throw new Error('Socket.io has not been initialised. Call init(httpServer) first.');
  return io;
}

/**
 * Returns a live snapshot of connected sessions, used by the metrics endpoint.
 *
 * @returns {{
 *   unique_users:  number,
 *   total_sockets: number,
 *   by_platform:   { desktop: number, web: number, mobile_web: number }
 * }}
 */
function getSessionStats() {
  let totalSockets = 0;
  const byPlatform = { desktop: 0, web: 0, mobile_web: 0 };

  for (const userSessions of sessions.values()) {
    for (const { platform } of userSessions.values()) {
      totalSockets++;
      if (byPlatform[platform] !== undefined) byPlatform[platform]++;
    }
  }

  return { unique_users: sessions.size, total_sockets: totalSockets, by_platform: byPlatform };
}

/**
 * Returns a flat array of every active socket session for the admin dashboard.
 * Username is sourced from the in-memory cache populated on connect.
 */
function getActiveSessions() {
  const rows = [];
  for (const [userId, socketMap] of sessions) {
    for (const [socketId, info] of socketMap) {
      rows.push({
        userId,
        socketId,
        platform:    info.platform,
        connectedAt: info.connectedAt.toISOString(),
        username:    info.username,
      });
    }
  }
  return rows.sort((a, b) => a.connectedAt.localeCompare(b.connectedAt));
}

/**
 * Push a live presence snapshot to all currently open admin dashboard sessions.
 * Called on every socket connect and disconnect.
 */
function pushPresenceToAdmin() {
  if (!io) return;
  io.to('admin').emit('admin_presence_update', {
    active_sessions: getActiveSessions(),
    stats:           getSessionStats(),
  });
}

module.exports = { init, getIO, getSessionStats, getActiveSessions };
