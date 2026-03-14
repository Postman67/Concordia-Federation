# Concordia Federation — Admin Reference

> Last updated: March 7, 2026 9:00 PM PST

> Admin endpoints and the dashboard are restricted to the account whose UUID matches the `ADMIN_UUID` environment variable.

Base URL: `https://federation.concordiachat.com` (local: `http://localhost:3000`)

---

## Authentication

Log in with the admin Concordia account via the standard login endpoint:

```http
POST /api/auth/login
{ "email": "admin@concordiachat.com", "password": "..." }
```

Use the returned JWT as a Bearer token on all `/api/admin/*` requests:

```
Authorization: Bearer <token>
```

Requests return `403 Forbidden` if the token is valid but does not belong to the admin UUID.

---

## REST Endpoints — `/api/admin` 🔒🛡

### `GET /api/admin/stats`

Returns federation-wide aggregate counts.

**`200 OK`**
```json
{
  "stats": {
    "total_users": "42",
    "total_server_entries": "137",
    "unique_servers": "25"
  }
}
```

---

### `GET /api/admin/users`

Returns all users with their settings and server count.

**`200 OK`**
```json
{
  "users": [
    {
      "id": "a3f8c21d-...",
      "username": "petersmith",
      "email": "peter@example.com",
      "display_name": "Peter",
      "avatar_url": "https://example.com/avatar.png",
      "theme": "dark",
      "status": "online",
      "last_seen": "...",
      "server_count": "3",
      "created_at": "..."
    }
  ]
}
```

---

### `GET /api/admin/users/:id`

Returns full detail for a single user including their server list.

**`200 OK`**
```json
{
  "user": {
    "id": "...", "username": "petersmith", "email": "...",
    "display_name": "Peter", "avatar_url": "...", "theme": "dark",
    "status": "online", "last_seen": "...", "created_at": "...", "updated_at": "..."
  },
  "servers": [
    { "id": "...", "server_address": "...", "server_name": "...", "position": 0, "added_at": "..." }
  ]
}
```

**`404`** User not found

---

### `PATCH /api/admin/users/:id`

Modifies a user's account fields or settings. Only sent fields are updated.

**Request body** — all fields optional

| Field | Type | Rules |
|-------|------|-------|
| `username` | string | 3–50 chars. |
| `email` | string | Valid email. |
| `display_name` | string | Max 100 chars. |
| `avatar_url` | string | Valid URL. |
| `theme` | string | `"dark"` or `"light"`. |
| `status` | string | `online` \| `idle` \| `dnd` \| `invisible` \| `offline`. |

**`200 OK`** Returns updated user object.

**`400`** Validation failed · **`404`** User not found · **`409`** Username/email conflict · **`500`** Server error

> Password resets are not exposed via the admin API. Use a direct DB update for emergency resets.

> Saving triggers an `account_updated` WebSocket event to all of the user's active sessions.

---

### `DELETE /api/admin/users/:id`

Permanently deletes a user and all associated settings and servers (cascade).

> The master admin UUID (`ADMIN_UUID`) cannot be deleted.  
> All active WebSocket sessions for the deleted user receive a `session_revoked` event before the row is removed.

**`204 No Content`** — deleted successfully.

**`400`** Attempt to delete admin account · **`404`** User not found · **`500`** Server error

---

### `POST /api/admin/notice`

Broadcasts a federation-wide notice to **every currently connected client** via the `admin_notice` WebSocket event.

**Request body**

| Field | Type | Rules |
|-------|------|-------|
| `message` | string | Required. Max 500 chars. |
| `severity` | string | Optional. `"info"` (default) \| `"warning"` \| `"critical"`. |

```json
{ "message": "Scheduled maintenance in 10 minutes. Expect brief downtime.", "severity": "warning" }
```

**`200 OK`**
```json
{ "ok": true, "message": "...", "severity": "warning" }
```

**`400`** Validation failed · **`401`** Missing/invalid token · **`403`** Not admin

---

### `GET /api/admin/metrics`

Returns a live snapshot of all federation metrics.

**`200 OK`**
```json
{
  "metrics": {
    "active_connections": 12,
    "unique_users_online": 9,
    "sessions_by_platform": { "desktop": 6, "web": 4, "mobile_web": 2 },
    "dau": 8,
    "wau": 31,
    "avg_servers_per_user": "2.4",
    "status_distribution": { "online": 5, "idle": 2, "dnd": 1, "invisible": 0, "offline": 34 },
    "db_pool": { "total": 10, "idle": 8, "waiting": 0 },
    "uptime_seconds": 7200,
    "memory_mb": { "rss": 82, "heap_used": 46, "heap_total": 64 },
    "lifetime": { "login_success": 1423, "login_fail": 37, "user_registered": 42 },
    "avg_response_ms": { "/api/auth": 45, "/api/user": 12, "/api/settings": 8, "/api/servers": 15 }
  }
}
```

> Also prunes `federation_events` rows older than 90 days on each call (fire-and-forget).

---

### `GET /api/admin/metrics/history`

Returns a per-day breakdown of event counts for chart rendering.

**Query parameters**

| Param | Default | Max |
|-------|---------|-----|
| `days` | `7` | `90` |

**`200 OK`**
```json
{
  "history": [
    { "date": "2026-03-01", "login_success": 15, "login_fail": 2, "user_registered": 3 },
    { "date": "2026-03-02", "login_success": 22, "login_fail": 1, "user_registered": 0 }
  ]
}
```

Every day in the requested range is always present (zero-filled if no events occurred).

---

## Dashboard

The admin dashboard is a static single-page app served directly by the Federation server.

- **URL:** `https://federation.concordiachat.com/dashboard`
- **Source:** `public/dashboard/` — HTML, CSS, and vanilla JS
- Log in with the admin Concordia credentials. The JWT is stored in `localStorage`.
- Token expiry and admin access are verified on every page load — expired or non-admin sessions redirect to the login screen immediately.

### Features

| Feature | Details |
|---------|---------|
| User table | All users with status badge, last seen, server count, created date |
| Live search | Filter by username or email |
| Edit modal | Modify username, email, display name, avatar URL, theme, status |
| Delete | Confirms before deletion; master admin account is protected |
| Stats page | Total users, unique servers, total server entries |
| Metrics page | Live connections, DAU/WAU, status distribution, DB pool, uptime, memory, lifetime event counters, avg response times, 7-day bar charts |

---

## Admin-related WebSocket Events

These events are emitted as a side-effect of admin actions. See [Federation-API.md](./Federation-API.md#websocket-events) for the full WebSocket connection reference.

### `session_revoked`
Room: **user:\<userId\>** (all sessions for the affected user)  
Fired by `DELETE /api/admin/users/:id`. Clients must clear all local state and redirect to the login screen.

```json
{ "reason": "Account deleted by administrator." }
```

---

### `account_updated`
Room: **user:\<userId\>** (all sessions for the affected user)  
Fired by `PATCH /api/admin/users/:id`. Clients should re-fetch `GET /api/user/me` to get the latest profile.

```json
{ "user": { "id": "...", "username": "...", "email": "...", "display_name": "...", "theme": "...", "status": "..." } }
```

---

### `admin_notice`
Room: **presence** (all connected clients)  
Fired by `POST /api/admin/notice`. Clients should surface this as a system notification.

```json
{ "message": "Scheduled maintenance in 10 minutes.", "severity": "warning" }
```

`severity` values: `info` · `warning` · `critical`
