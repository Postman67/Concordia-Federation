# Concordia-Federation

The backend federation server for [Concordia](https://github.com/Postman67/Concordia) — a decentralised chat platform. This service handles authentication, user profiles, server membership, real-time presence via WebSockets, the admin dashboard for federation operators, and a private internal API for first-party services.

---

## Overview

Concordia-Federation is a standalone Node.js/Express API that Concordia clients connect to. Each instance is independently hosted and manages its own user base, exposing a public REST API, a Socket.IO endpoint for live events, and a key-authenticated internal API for service-to-service calls.

- **REST API** — auth, user profiles, server membership, settings, admin
- **WebSockets** — real-time presence, status updates, platform tracking, and live admin push events via Socket.IO
- **Admin Dashboard** — browser-based SPA at `/dashboard` for managing users and viewing live federation metrics
- **Internal API** — service-to-service endpoints for Concordia-Social (user search, profile lookup) behind a shared secret
- **Metrics** — lifetime event counters, DAU/WAU, response-time tracking, DB pool health, per-platform connection counts

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express 4 |
| Database | PostgreSQL (via `pg`) |
| Real-time | Socket.IO 4 |
| Auth | JWT + bcrypt |
| Validation | express-validator |
| Hosting | Railway |

---

## Project Structure

```
src/
  app.js                  # Entry point — Express app, middleware, route mounting
  config/                 # DB pool, environment config
  controllers/
    authController.js
    userController.js
    settingsController.js
    serversController.js
    adminController.js
    internalController.js # Service-to-service endpoints
  middleware/
    requireAuth.js        # JWT guard for user routes
    requireAdmin.js       # Admin UUID guard
    requireInternal.js    # X-Internal-Key guard for internal API
    validate.js           # express-validator error handler
  metrics/
    events.js             # DB event logging (login_success, login_fail, user_registered)
    responseTime.js       # In-memory rolling avg per route
  routes/
    auth.js
    user.js
    settings.js
    servers.js
    admin.js
    internal.js
  socket/
    index.js              # Socket.IO init, auth, presence, session registry, grace-period offline
db/
  schema.sql              # Full DB schema (migration-safe, IF NOT EXISTS)
public/
  dashboard/              # Admin SPA (index.html, app.js, style.css, favicon.svg)
docs/
  Federation-API.md                    # Full public REST + WebSocket reference
  Admin.md                             # Admin dashboard and API reference
  federation-api-internal.md           # Internal API reference
  federation-API-changelog.md
  admin-changelog.md
  federation-api-internal-changelog.md
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+

### Install

```bash
git clone https://github.com/Postman67/Concordia-Federation.git
cd Concordia-Federation
npm install
```

### Configure

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Key variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (Railway) **or** use the `DB_*` individual vars |
| `JWT_SECRET` | Long random secret — `openssl rand -hex 64` |
| `JWT_EXPIRES_IN` | Token lifetime (default `7d`) |
| `BCRYPT_SALT_ROUNDS` | Hash cost factor (12–14 recommended for production) |
| `ADMIN_UUID` | UUID of the Concordia account with master admin access |
| `INTERNAL_API_KEY` | Shared secret for service-to-service calls — `openssl rand -hex 32` |

### Database

Run the schema against your PostgreSQL instance:

```bash
psql -d your_db_name -f db/schema.sql
```

The schema is migration-safe — all `CREATE TABLE` statements use `IF NOT EXISTS`.

### Run

```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

The server starts on the port defined by `PORT` (default `3000`).

---

## Admin Dashboard

Navigate to `/dashboard` in a browser. Sign in with the Concordia account whose UUID matches `ADMIN_UUID` in your `.env`.

The dashboard provides:
- **Users** — search, view, edit, and delete federation users
- **Stats** — total users, unique servers, server entries
- **Metrics** — fully real-time via WebSocket push:
  - Live socket count and unique users online
  - Per-platform connection breakdown (Desktop / Web / Mobile Web)
  - **Active Connections table** — every live socket with username, platform badge, socket ID, and a live "connected for" counter that ticks every second
  - Uptime, memory, and DB pool updated every 10 seconds — no polling
  - DAU/WAU, lifetime event counters, avg response times, and 7-day bar charts (loaded once on tab open)

See [docs/Admin.md](docs/Admin.md) for the full admin API and dashboard reference.

---

## WebSocket — Session & Presence

Clients connect with a JWT in the handshake auth and optionally declare their platform:

```js
const socket = io('https://federation.concordiachat.com', {
  auth: { token: '<jwt>', platform: 'desktop' }, // 'desktop' | 'web' | 'mobile_web'
});
```

- The server maintains an in-memory session registry (`Map<userId, Map<socketId, {platform, connectedAt, username}>>`)
- When a user's last socket disconnects, an 8-second grace period begins before their status is written as `offline` — absorbing page reloads and brief network drops
- The admin dashboard is pushed a live presence snapshot on every connect and disconnect

---

## Internal API

First-party services (e.g. Concordia-Social) can call internal endpoints using the shared `INTERNAL_API_KEY`:

```
GET /api/internal/users/search?q=<prefix>
GET /api/internal/users/:id
```

Pass the key as the `X-Internal-Key` header. See [docs/federation-api-internal.md](docs/federation-api-internal.md) for the full reference.

---

## API Documentation

| Document | Description |
|---|---|
| [docs/Federation-API.md](docs/Federation-API.md) | Public REST + WebSocket reference |
| [docs/Admin.md](docs/Admin.md) | Admin dashboard and API reference |
| [docs/federation-api-internal.md](docs/federation-api-internal.md) | Internal service-to-service API |
| [docs/federation-API-changelog.md](docs/federation-API-changelog.md) | Public API changelog |
| [docs/admin-changelog.md](docs/admin-changelog.md) | Admin API changelog |
| [docs/federation-api-internal-changelog.md](docs/federation-api-internal-changelog.md) | Internal API changelog |

---

## Related Repositories

| Repo | Description |
|---|---|
| [Concordia](https://github.com/Postman67/Concordia) | Marketing frontend |
| [Concordia-Federation](https://github.com/Postman67/Concordia-Federation) | Global identity — usernames, auth, server registry |
| [Concordia-Client](https://github.com/Postman67/Concordia-Client) | User-facing chat application |
| [Concordia-Server](https://github.com/Postman67/Concordia-Server) | Self-hostable server software |
| [Concordia-Social](https://github.com/Postman67/Concordia-Social) | Friends and direct messaging service |