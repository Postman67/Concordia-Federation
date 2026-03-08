# Concordia Federation — API Reference

> Last updated: March 7, 2026 6:10 PM PST

> The Federation is the sole authentication and settings authority for all Concordia clients.
> Individual servers never receive personal user data — only the user's `id`.

Base URL: `https://federation.concordiachat.com` (local: `http://localhost:3000`)

All request and response bodies are JSON.

### Authentication

All protected endpoints require a JWT in the `Authorization` header:
```
Authorization: Bearer <token>
```
Tokens are issued by `/api/auth/register` and `/api/auth/login`. They expire after the duration set in `JWT_EXPIRES_IN` (default `7d`).

### WebSocket Connection

The Federation exposes a Socket.io endpoint at the same URL as the HTTP server.
Clients authenticate by passing their JWT in the `auth` handshake option:

```js
import { io } from 'socket.io-client';

const socket = io('https://federation.concordiachat.com', {
  auth: { token: '<jwt>' }
});
```

On successful connection the client is placed in two rooms:
- `user:<userId>` — events targeted at **your sessions only**
- `presence` — events broadcast to **all connected clients**

See the [WebSocket Events](#websocket-events) section for the full event reference.

---

## Health Check

### `GET /health`

**Response `200`**
```json
{ "status": "ok" }
```

---

## Auth — `/api/auth`

### `POST /api/auth/register`

Creates a new Federation account. Returns a JWT.

**Request body**

| Field | Type | Rules |
|-------|------|-------|
| `username` | string | 3–50 chars. Letters, numbers, `_`, `-` only. |
| `email` | string | Valid email address. |
| `password` | string | Min 8 chars, one uppercase letter, one number. |

```json
{ "username": "petersmith", "email": "peter@example.com", "password": "Secret123" }
```

**`201 Created`**
```json
{
  "message": "Account created successfully.",
  "token": "<jwt>",
  "user": { "id": "a3f8c21d-7e44-4b1c-9f02-3d5e6a8b1c0f", "username": "petersmith", "email": "peter@example.com", "created_at": "..." }
}
```

**`400`** Validation failed · **`409`** Username or email already taken · **`500`** Server error

---

### `POST /api/auth/login`

Authenticates an existing user. Returns a JWT.

**Request body**

| Field | Type |
|-------|------|
| `email` | string |
| `password` | string |

**`200 OK`**
```json
{
  "message": "Login successful.",
  "token": "<jwt>",
  "user": { "id": "a3f8c21d-7e44-4b1c-9f02-3d5e6a8b1c0f", "username": "petersmith", "email": "peter@example.com" }
}
```

**`400`** Validation failed · **`401`** Invalid credentials · **`500`** Server error

> The same `401` message is returned for both unknown email and wrong password to prevent user enumeration.

---

## User — `/api/user` 🔒

### `GET /api/user/me`

Returns the authenticated user's profile joined with their current settings.

**`200 OK`**
```json
{
  "user": {
    "id": "a3f8c21d-7e44-4b1c-9f02-3d5e6a8b1c0f",
    "username": "petersmith",
    "email": "peter@example.com",
    "created_at": "...",
    "display_name": "Peter",
    "avatar_url": "https://example.com/avatar.png",
    "theme": "dark",
    "status": "online",
    "last_seen": "..."
  }
}
```

**`401`** Missing/invalid token · **`404`** User not found · **`500`** Server error

---

## Status — `/api/user` 🔒

Users have five possible statuses:

| Value | Meaning |
|-------|---------|
| `online` | Actively connected to the Federation. |
| `idle` | Logged in but no recent client activity (set by the client after inactivity). |
| `dnd` | Do Not Disturb — manually set. |
| `invisible` | Logged in but appears `offline` to all other users. |
| `offline` | Not logged in, or manually set. |

### `PUT /api/user/status`

Explicitly sets the authenticated user’s status.

**Request body**

| Field | Type | Values |
|-------|------|--------|
| `status` | string | `online` \| `idle` \| `dnd` \| `invisible` \| `offline` |

```json
{ "status": "dnd" }
```

**`200 OK`**
```json
{ "status": "dnd" }
```

**`400`** Invalid status value · **`401`** Missing/invalid token · **`500`** Server error

---

### `POST /api/user/heartbeat`

Updates `last_seen` to now. If the user’s current status is `offline`, it is automatically switched to `online`.

Clients should call this on a regular interval (e.g. every 30–60 seconds) while the user is active, and call `PUT /api/user/status` with `idle` after a period of inactivity.

**`200 OK`**
```json
{ "ok": true }
```

**`401`** Missing/invalid token · **`500`** Server error

---

### `GET /api/user/status/:id`

Returns the visible status of any user by their UUID.

> `invisible` users are returned as `offline` — the caller cannot tell the difference.

**`200 OK`**
```json
{ "status": "online", "last_seen": "..." }
```

**`401`** Missing/invalid token · **`404`** User not found · **`500`** Server error

---

## Settings — `/api/settings` 🔒

Globally synced across every client the user is logged into.

### `GET /api/settings`

Returns the authenticated user's settings.

**`200 OK`**
```json
{
  "settings": {
    "display_name": "Peter",
    "avatar_url": "https://example.com/avatar.png",
    "theme": "dark",
    "updated_at": "..."
  }
}
```

---

### `PUT /api/settings`

Updates one or more settings fields. Only sent fields are changed (others are left as-is).

**Request body** — all fields optional

| Field | Type | Rules |
|-------|------|-------|
| `display_name` | string | Max 100 chars. |
| `avatar_url` | string | Must be a valid URL. |
| `theme` | string | `"dark"` or `"light"`. |

```json
{ "display_name": "Peter", "theme": "light" }
```

**`200 OK`** Returns updated settings object.

**`400`** Validation failed · **`401`** Missing/invalid token · **`500`** Server error

---

## Servers — `/api/servers` 🔒

The user's personal server list, stored in the Federation.
Clients use this to populate the left-hand sidebar. No personal user data is ever sent to servers.

### `GET /api/servers`

Returns the authenticated user's full server list, ordered by `position`.

**`200 OK`**
```json
{
  "servers": [
    { "id": "a3f8c21d-7e44-4b1c-9f02-3d5e6a8b1c0f", "server_address": "192.168.1.10:8080", "server_name": "My Home Server", "position": 0, "added_at": "..." },
    { "id": "b7e2d14f-3c55-4a2b-8e01-1f4d7b9c2e1a", "server_address": "play.concordia.gg:8080", "server_name": null, "position": 1, "added_at": "..." }
  ]
}
```

---

### `POST /api/servers`

Adds a server to the user's list.

**Request body**

| Field | Type | Rules |
|-------|------|-------|
| `server_address` | string | Required. IP or domain:port. Max 255 chars. |
| `server_name` | string | Optional. The server's display name, fetched from the server by the client and pushed here. Max 100 chars. |

```json
{ "server_address": "192.168.1.10:8080", "server_name": "My Home Server" }
```

**`201 Created`**
```json
{
  "server": { "id": "a3f8c21d-7e44-4b1c-9f02-3d5e6a8b1c0f", "server_address": "192.168.1.10:8080", "server_name": "My Home Server", "position": 0, "added_at": "..." }
}
```

**`400`** Validation failed · **`401`** Missing/invalid token · **`409`** Server already in list · **`500`** Server error

---

### `PATCH /api/servers/:id`

Updates the `nickname` or `position` of an entry. Only sent fields are changed.

**Request body** — all fields optional

| Field | Type | Rules |
|-------|------|-------|
| `server_name` | string | The server's display name pushed from the client. Max 100 chars. |
| `position` | integer | Non-negative integer. |

**`200 OK`** Returns updated server object.

**`400`** Validation failed · **`401`** Missing/invalid token · **`404`** Not found · **`500`** Server error

---

### `DELETE /api/servers/:id`

Removes a server from the user's list.

**`204 No Content`** — deleted successfully.

**`401`** Missing/invalid token · **`404`** Not found · **`500`** Server error

---

## Admin — `/api/admin` 🔒🛡

All admin endpoints require a JWT whose `sub` claim matches the `ADMIN_UUID` environment variable.
Obtain a token by logging in as the admin account via `POST /api/auth/login`.

Admin requests return `403 Forbidden` if the token is valid but does not belong to the admin UUID.

---

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
  "user": { "id": "...", "username": "petersmith", "email": "...", "display_name": "Peter", "avatar_url": "...", "theme": "dark", "created_at": "...", "updated_at": "..." },
  "servers": [ { "id": "...", "server_address": "...", "server_name": "...", "position": 0, "added_at": "..." } ]
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

**`200 OK`** Returns updated user object.

**`400`** Validation failed · **`404`** User not found · **`409`** Username/email conflict · **`500`** Server error

> Password resets are not exposed via the admin API. Use a direct DB update for emergency resets.

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

## Dashboard

The admin dashboard is served as a static single-page app at `/dashboard`.

- **URL:** `https://federation.concordiachat.com/dashboard`
- Log in with the admin Concordia account credentials.
- The dashboard communicates with the `/api/admin/*` endpoints using the JWT stored in `localStorage`.
- Token expiry is enforced on every page load — expired sessions redirect to the login screen automatically.

---

## WebSocket Events

Socket URL: `wss://federation.concordiachat.com`  
Library: [Socket.io v4](https://socket.io/docs/v4/)

### Connection

```js
const socket = io('https://federation.concordiachat.com', {
  auth: { token: localStorage.getItem('fed_token') }
});

socket.on('connect_error', (err) => {
  // err.message: 'Authentication required.' or 'Invalid or expired token.'
});
```

---

### Client → Server events

#### `ping`
Sent by the client on its heartbeat interval (recommended: every 25–30 s).  
The server replies with `heartbeat_ack`. Also call `POST /api/user/heartbeat` on the same interval to update `last_seen` in the database.

```js
setInterval(() => socket.emit('ping'), 25000);
```

---

### Server → Client events

#### `heartbeat_ack`
Room: **requesting socket only**  
Sent in response to a `ping`. Returns the server’s current UTC time so clients can detect clock skew.

```json
{ "server_time": "2026-03-07T18:10:00.000Z" }
```

---

#### `status_change`
Room: **presence** (all connected clients)  
Fired whenever any user calls `PUT /api/user/status` or their status changes.  
`invisible` users are always emitted as `offline` — the real status is never sent to other clients.

```json
{ "userId": "a3f8c21d-...", "status": "online" }
```

---

#### `settings_sync`
Room: **user:\<userId\>** (your sessions only, excluding the socket that triggered the change)  
Fired when `PUT /api/settings` succeeds. All your other open clients should apply these values immediately.

```json
{ "display_name": "Peter", "avatar_url": "https://...", "theme": "dark", "updated_at": "..." }
```

---

#### `server_list_sync`
Room: **user:\<userId\>** (your sessions only, excluding the triggering socket)  
Fired after any `POST`, `PATCH`, or `DELETE` to `/api/servers`. Contains the full updated list so clients don’t need to diff.

```json
{
  "servers": [
    { "id": "...", "server_address": "...", "server_name": "...", "position": 0, "added_at": "..." }
  ]
}
```

---

#### `session_revoked`
Room: **user:\<userId\>** (all sessions for that user)  
Fired when an admin deletes the user’s account. Clients must clear all local state and redirect to the login screen immediately.

```json
{ "reason": "Account deleted by administrator." }
```

---

#### `account_updated`
Room: **user:\<userId\>** (all sessions for that user)  
Fired when an admin edits the user’s account via `PATCH /api/admin/users/:id`. Clients should re-fetch `GET /api/user/me` to get the latest profile data.

```json
{ "user": { "id": "...", "username": "...", "email": "...", "display_name": "...", "theme": "...", "status": "..." } }
```

---

#### `admin_notice`
Room: **presence** (all connected clients)  
Fired when an admin calls `POST /api/admin/notice`. Clients should surface this to the user as a system notification.

```json
{ "message": "Scheduled maintenance in 10 minutes.", "severity": "warning" }
```

`severity` values: `info` · `warning` · `critical`

---

## Database Schema

```
users
├── id             UUID         PRIMARY KEY DEFAULT gen_random_uuid()
├── username       VARCHAR(50)  UNIQUE NOT NULL
├── email          VARCHAR(255) UNIQUE NOT NULL
├── password_hash  VARCHAR(255) NOT NULL          ← bcrypt hash, never plaintext
├── created_at     TIMESTAMPTZ  DEFAULT NOW()
└── updated_at     TIMESTAMPTZ  DEFAULT NOW()

user_settings                                     ← one row per user, globally synced
├── user_id        UUID PRIMARY KEY → users.id
├── display_name   VARCHAR(100)
├── avatar_url     VARCHAR(500)
├── theme          VARCHAR(20)  DEFAULT 'dark'
├── status         VARCHAR(20)  DEFAULT 'offline'  ← online | idle | dnd | invisible | offline
├── last_seen      TIMESTAMPTZ                      ← updated by heartbeat / PUT /status
└── updated_at     TIMESTAMPTZ  DEFAULT NOW()

user_servers                                      ← server list, no user PII sent to servers
├── id             UUID         PRIMARY KEY DEFAULT gen_random_uuid()
├── user_id        UUID → users.id
├── server_address VARCHAR(255) NOT NULL
├── server_name    VARCHAR(100)        ← pushed by client from the server
├── position       INTEGER DEFAULT 0
└── added_at       TIMESTAMPTZ  DEFAULT NOW()
```

