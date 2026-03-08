/**
 * Federation WebSocket Emitter
 *
 * Thin wrappers around Socket.io broadcasts so controllers never import the io
 * instance directly. Each function documents its room target and payload shape.
 */

const { getIO } = require('./index');

/**
 * Broadcast a user's status change to every connected client in the presence room.
 * `invisible` is normalised to `offline` so the real status is never exposed.
 *
 * @param {string}      userId
 * @param {string}      status           — raw status value from the DB
 * @param {string|null} [customStatus]   — custom status text
 * @param {Date|null}   [expiresAt]      — when the custom status expires (null = never)
 */
function emitStatusChange(userId, status, customStatus, expiresAt) {
  const visibleStatus = status === 'invisible' ? 'offline' : status;
  getIO().to('presence').emit('status_change', {
    userId,
    status: visibleStatus,
    custom_status: customStatus ?? null,
    custom_status_expires_at: expiresAt ?? null,
  });
}

/**
 * Push updated settings to all of the user's OTHER connected sessions.
 * The socket that triggered the change is excluded so it doesn't re-apply
 * its own update.
 *
 * @param {string} userId
 * @param {object} settings  — { display_name, avatar_url, theme, updated_at }
 * @param {string} [excludeSocketId]  — socket.id of the requesting connection
 */
function emitSettingsSync(userId, settings, excludeSocketId) {
  const room = getIO().to(`user:${userId}`);
  const target = excludeSocketId ? room.except(excludeSocketId) : room;
  target.emit('settings_sync', settings);
}

/**
 * Push the full updated server list to all of the user's OTHER connected sessions.
 *
 * @param {string} userId
 * @param {Array}  servers  — full ordered server list for the user
 * @param {string} [excludeSocketId]
 */
function emitServerListSync(userId, servers, excludeSocketId) {
  const room = getIO().to(`user:${userId}`);
  const target = excludeSocketId ? room.except(excludeSocketId) : room;
  target.emit('server_list_sync', { servers });
}

/**
 * Force-disconnect all sessions belonging to a deleted user.
 * Clients should clear local state and redirect to login on receiving this.
 *
 * @param {string} userId
 * @param {string} [reason]
 */
function emitSessionRevoked(userId, reason = 'Account deleted by administrator.') {
  getIO().to(`user:${userId}`).emit('session_revoked', { reason });
}

/**
 * Notify all of a user's connected sessions that their account was modified
 * by an admin so they can re-fetch /api/user/me.
 *
 * @param {string} userId
 * @param {object} user  — updated user fields returned by the admin controller
 */
function emitAccountUpdated(userId, user) {
  getIO().to(`user:${userId}`).emit('account_updated', { user });
}

/**
 * Broadcast a federation-wide notice to every connected client.
 *
 * @param {string} message
 * @param {'info'|'warning'|'critical'} [severity]
 */
function emitAdminNotice(message, severity = 'info') {
  getIO().to('presence').emit('admin_notice', { message, severity });
}

module.exports = {
  emitStatusChange,
  emitSettingsSync,
  emitServerListSync,
  emitSessionRevoked,
  emitAccountUpdated,
  emitAdminNotice,
};
