/**
 * Federation event logger.
 * Fire-and-forget — never throws or awaits, so it never blocks a request.
 * Writing to two tables:
 *   federation_events   — individual rows, pruned to 90 days (used for charts)
 *   federation_counters — running lifetime totals (survive the prune)
 */
const pool = require('../config/db');

const EVENT = {
  LOGIN_SUCCESS: 'login_success',
  LOGIN_FAIL:    'login_fail',
  REGISTERED:    'user_registered',
};

function logEvent(type) {
  pool.query('INSERT INTO federation_events (event_type) VALUES ($1)', [type])
    .catch(e => console.error('metrics logEvent:', e.message));

  pool.query(
    `INSERT INTO federation_counters (key, value) VALUES ($1, 1)
     ON CONFLICT (key) DO UPDATE SET value = federation_counters.value + 1`,
    [type]
  ).catch(e => console.error('metrics counter:', e.message));
}

module.exports = { logEvent, EVENT };
