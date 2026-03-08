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
 * Events received from clients
 * ─────────────────────────────────────────────────────────────────────────────
 * ping              → server replies with heartbeat_ack
 *   No payload required.
 */

const { Server }  = require('socket.io');
const jwt         = require('jsonwebtoken');

let io = null;

/**
 * Initialise the Socket.io server and attach it to an existing http.Server.
 * Called once from app.js.
 */
function init(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
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
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication required.'));
    }
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = payload.sub;   // UUID string
      next();
    } catch {
      next(new Error('Invalid or expired token.'));
    }
  });

  // ── Connection handler ────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    const { userId } = socket;

    // Join the user's personal room and the global presence room
    socket.join(`user:${userId}`);
    socket.join('presence');

    console.log(`[WS] connected  userId=${userId} socketId=${socket.id}`);

    // ── ping → heartbeat_ack ──────────────────────────────────────────────
    // Clients send `ping` on their heartbeat interval; we reply with server
    // time so they can detect clock skew and confirm the socket is alive.
    socket.on('ping', () => {
      socket.emit('heartbeat_ack', { server_time: new Date().toISOString() });
    });

    socket.on('disconnect', (reason) => {
      console.log(`[WS] disconnected userId=${userId} socketId=${socket.id} reason=${reason}`);
    });
  });

  console.log('[WS] Socket.io server initialised.');
  return io;
}

/** Return the shared io instance (throws if called before init). */
function getIO() {
  if (!io) throw new Error('Socket.io has not been initialised. Call init(httpServer) first.');
  return io;
}

module.exports = { init, getIO };
