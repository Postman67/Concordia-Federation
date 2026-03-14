# Concordia Federation — Admin Changelog

All notable changes to the admin API, dashboard, and admin-side infrastructure are documented here.
Format: `[YYYY-MM-DD HH:MM TZ] — Summary`

---

## [2026-03-14] — Platform tracking + graceful offline

**Changed — `GET /api/admin/metrics`**
- `active_connections` now counts live sockets from the in-memory session registry (was `engine.clientsCount`).
- Added `unique_users_online` — distinct users with at least one open socket.
- Added `sessions_by_platform` — `{ desktop, web, mobile_web }` breakdown of live sockets.

**Dashboard**
- Renamed `Live Connections` card → `Live Sockets`.
- Added `Unique Users Online` metric card.
- Added `Platform Breakdown` panel (shares column with DB Pool) showing desktop / web / mobile web socket counts.

---

## [2026-03-07 9:00 PM PST] — Metrics

### Added

**New database tables:**
- `federation_events` — append-only event log (login_success, login_fail, user_registered). Rows older than 90 days are pruned automatically.
- `federation_counters` — lifetime totals per event type; survive the 90-day prune.

**`GET /api/admin/metrics`** — live snapshot including:
- Active WebSocket connections
- Daily Active Users (24 h) and Weekly Active Users (7 d)
- Average servers per user
- Status distribution across all users
- PostgreSQL pool stats (total / idle / waiting)
- Process uptime and memory (RSS, heap)
- Lifetime event totals (successful logins, failed attempts, registrations)
- Average response time per primary route since last restart (`/api/auth`, `/api/user`, `/api/settings`, `/api/servers`)

**`GET /api/admin/metrics/history?days=7`** — per-day breakdown of login_success, login_fail, user_registered (max 90 days). Always returns a complete day array with zero-filled gaps.

**Admin dashboard Metrics tab** — displays all of the above with auto-refresh every 30 s. Includes CSS-only 7-day bar charts; no external libraries.

### Changed

- `POST /api/auth/register` and `POST /api/auth/login` now emit events to `federation_events` and increment `federation_counters` to power the metrics system.
- Primary API routes now tracked for average response time via an in-memory rolling accumulator (resets on server restart).
