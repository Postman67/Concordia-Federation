# Concordia-Federation

The backend federation server for [Concordia](https://github.com/Postman67/Concordia) — a decentralised chat platform. This service handles authentication, user profiles, server membership, real-time presence via WebSockets, and the admin dashboard for federation operators.

---

## Overview

Concordia-Federation is a standalone Node.js/Express API that Concordia clients connect to. Each instance is independently hosted and manages its own user base, exposing a REST API and a Socket.IO endpoint for live events.

- **REST API** — auth, user profiles, server membership, settings, admin
- **WebSockets** — real-time presence, status updates, and admin push events via Socket.IO
- **Admin Dashboard** — browser-based SPA at `/dashboard` for managing users and viewing federation metrics
- **Metrics** — lifetime event counters, daily active users, response-time tracking, DB pool health

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
  app.js              # Entry point — Express app, middleware, route mounting
  config/             # DB pool, environment config
  controllers/        # Auth, user, settings, servers, admin
  middleware/         # JWT auth guard, admin guard
  metrics/            # Event logging (events.js) and response-time tracking (responseTime.js)
  routes/             # auth, user, settings, servers, admin
  socket/             # Socket.IO setup and event handlers
db/
  schema.sql          # Full DB schema (migration-safe)
public/
  dashboard/          # Admin SPA (index.html, app.js, style.css)
docs/
  Federation-API.md   # Full REST API reference
  Admin.md            # Admin dashboard and metrics endpoint reference
  federation-API-changelog.md
  admin-changelog.md
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
| `ADMIN_UUID` | UUID of the Concordia account that has admin access |

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
- **Metrics** — live connections, DAU/WAU, uptime, memory, DB pool health, lifetime event counters, and 7-day bar charts

See [docs/Admin.md](docs/Admin.md) for the full admin API and dashboard reference.

---

## API Documentation

Full endpoint reference: [docs/Federation-API.md](docs/Federation-API.md)

Changelogs:
- [docs/federation-API-changelog.md](docs/federation-API-changelog.md)
- [docs/admin-changelog.md](docs/admin-changelog.md)

---

## Related repositories

| Repo | Description |
|---|---|
| [Concordia](https://github.com/Postman67/Concordia) | Marketing frontend |
| [Concordia-Federation](https://github.com/Postman67/Concordia-Federation) | Global identity — usernames, auth, server registry |
| [Concordia-Client](https://github.com/Postman67/Concordia-Client) | User-facing chat application |
| [Concordia-Server](https://github.com/Postman67/Concordia-Server) | Self-hostable server software |