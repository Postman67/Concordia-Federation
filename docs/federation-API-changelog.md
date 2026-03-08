# Concordia Federation — API Changelog

All notable changes to the Federation API are documented here.
Format: `[YYYY-MM-DD HH:MM TZ] — Summary`

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
