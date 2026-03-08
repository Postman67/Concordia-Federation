/**
 * Rolling average response time tracker for primary API routes.
 * Uses in-memory counters — resets on server restart (by design).
 *
 * Usage:
 *   app.use('/api/auth', track('/api/auth'), authRoutes);
 *
 * Read:
 *   const { getStats } = require('./metrics/responseTime');
 *   getStats(); // → { '/api/auth': 42, '/api/user': 18, ... }
 */

const records = {};

/**
 * Express middleware factory. Intercepts response finish to record elapsed time.
 * @param {string} routeKey  — label used as the key in getStats() output
 */
function track(routeKey) {
  return (_req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      if (!records[routeKey]) records[routeKey] = { count: 0, totalMs: 0 };
      records[routeKey].count++;
      records[routeKey].totalMs += ms;
    });
    next();
  };
}

/**
 * Returns average response time (ms) per tracked route.
 * Routes with no requests yet return null.
 */
function getStats() {
  const out = {};
  for (const [key, s] of Object.entries(records)) {
    out[key] = s.count > 0 ? Math.round(s.totalMs / s.count) : null;
  }
  return out;
}

module.exports = { track, getStats };
