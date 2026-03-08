# Concordia Federation — API Changelog

All notable changes to the Federation API are documented here.
Format: `[YYYY-MM-DD HH:MM TZ] — Summary`

---

## [2026-03-07 9:00 PM PST] — Admin metrics

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

- `POST /api/auth/register` and `POST /api/auth/login` now emit events to `federation_events` and increment `federation_counters`.
- Primary API routes now tracked for response time via an in-memory rolling accumulator (resets on server restart).

---

## [2026-03-07 8:15 PM PST] — Custom status expiry

### Added

**New `user_settings` column:**

| Column | Type | Description |
|--------|------|-------------|
| `custom_status_expires_at` | `TIMESTAMPTZ` | When the custom status automatically clears. `NULL` means it never expires. |

**`PUT /api/user/status`** — now accepts an optional `custom_status_duration` field:

| Value | Duration |
|-------|----------|
| `15m` | 15 minutes |
| `1h` | 1 hour |
| `8h` | 8 hours |
| `24h` | 24 hours |
| `48h` | 48 hours |
| `3d` | 3 days |
| `never` | Never expires (default if omitted) |

Expiry is enforced server-side. `GET /api/user/me` and `GET /api/user/status/:id` return `null` for both `custom_status` and `custom_status_expires_at` once the expiry timestamp has passed — no client-side cleanup required.

Response now includes `custom_status_expires_at`.

### Changed

**`status_change` WebSocket event** — payload now includes `custom_status_expires_at`.

---

## [2026-03-07 7:30 PM PST] — User profiles & custom status

### Added

**New `user_settings` columns** (all nullable, backward-compatible migration included):

| Column | Type | Description |
|--------|------|-------------|
| `banner_url` | `VARCHAR(500)` | Link to the user's profile banner media. |
| `bio` | `VARCHAR(500)` | Short user biography. |
| `profile_link` | `VARCHAR(500)` | Arbitrary external link (e.g. Linktree, personal site). |
| `custom_status` | `VARCHAR(100)` | Custom status text shown alongside the base online/offline status. |

**`PUT /api/user/status`** — now accepts an optional `custom_status` field (max 100 chars). Send `""` to clear.  
Response now includes `custom_status`.

**`GET /api/user/status/:id`** — response now includes `custom_status`.

**`GET /api/user/me`** — response now includes `banner_url`, `bio`, `profile_link`, `custom_status`.

**`GET /api/settings`** — response now includes `banner_url`, `bio`, `profile_link`.

**`PUT /api/settings`** — now accepts `banner_url` (URL), `bio` (max 500 chars), `profile_link` (URL).  
Note: `custom_status` is intentionally not settable here — use `PUT /api/user/status` instead.

### Changed

**`status_change` WebSocket event** — payload now includes `custom_status`:
```json
{ "userId": "...", "status": "online", "custom_status": "Working from home 🏠" }
```

**`settings_sync` WebSocket event** — payload now includes `banner_url`, `bio`, `profile_link`.
