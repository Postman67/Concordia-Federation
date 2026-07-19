# Concordia Federation — API Changelog

All notable changes to the Federation API are documented here.
Format: `[YYYY-MM-DD HH:MM TZ] — Summary`

---
## [2026-07-19 b] Auth hardening: refresh rotation, revocation, lockout, email flows, TOTP 2FA

### Changed (BREAKING)
- **Identity tokens now default to 1 hour** (`JWT_EXPIRES_IN=1h`); login/register
  responses additionally return `refresh_token` and `expires_in`.
- `POST /api/auth/login` for accounts with 2FA enabled returns
  `{ mfa_required: true, mfa_token }` instead of a session — complete via
  `POST /api/auth/mfa/verify`.
- Per-IP rate limits on all credential endpoints (10/15 min) plus a global
  API budget (300/15 min); per-account lockout after 5 failed logins in
  15 min (429, applies even to the correct password while locked).
- `CORS_ORIGINS` (comma-separated allowlist) replaces the wildcard default on
  Federation and Social — unset still allows all but logs a loud warning.
- `INTERNAL_API_KEY` accepts multiple comma-separated keys (zero-downtime
  rotation); comparison is constant-time.

### Added
- `POST /api/auth/refresh` — rotating refresh: each use revokes the presented
  token and issues a new pair. **Reuse of a rotated token revokes the user's
  entire refresh-token family** (stolen-token defense).
- `POST /api/auth/logout` — blacklists the identity token's `jti` (immediate
  401 everywhere) and revokes the supplied refresh token.
- `POST /api/auth/verify-email/request` + `/confirm` — one-time 24 h links;
  confirmation page served at `/account/verify-email.html`.
- `POST /api/auth/password-reset/request` + `/confirm` — one-time 1 h links,
  enumeration-safe (always 200); page at `/account/reset-password.html`;
  a successful reset revokes every refresh token on the account.
- TOTP 2FA (RFC 6238, compatible with any authenticator app):
  `POST /api/auth/mfa/setup` → secret + otpauth URI; `/mfa/enable` → verify a
  live code, returns 8 single-use backup codes (shown once); `/mfa/verify` →
  completes an MFA login (mfa_token is one-time); `/mfa/disable`.
- Outbound email via Resend (`RESEND_API_KEY`, `EMAIL_FROM`); without a key,
  emails are logged to stdout (dev mode).
- New env vars: `REFRESH_TOKEN_TTL_DAYS` (30), `CORS_ORIGINS`,
  `RESEND_API_KEY`, `EMAIL_FROM`.

### Schema
- New tables: `refresh_tokens`, `revoked_jtis`, `email_tokens`,
  `auth_failures`, `user_mfa`; new column `users.email_verified`.

---
## [2026-07-19] Asymmetric signing + audience-scoped server tokens (BREAKING)

**Security rearchitecture** — closes the token-harvesting flaw where the
all-powerful identity JWT was sent to every (untrusted) chat server.

### Changed — token signing (BREAKING)
- All tokens are now **EdDSA (Ed25519)** signed. The shared `JWT_SECRET` is
  gone; the Federation signs with `JWT_PRIVATE_KEY` (PKCS8 PEM, generate via
  `node scripts/generate-keys.js`) and publishes public keys at
  `GET /.well-known/jwks.json`. Server and Social verify locally — no
  introspection round-trips, no shared secrets.
- Identity tokens now carry `aud: ["concordia:federation", "concordia:social"]`,
  an `iss` claim (the Federation's `PUBLIC_URL` origin), and a `jti`
  (reserved for the upcoming revocation list).
- **All previously issued HS256 tokens are invalid — users must log in again.**

### Added
- `GET /.well-known/jwks.json` — public signing keys (JWKS, cacheable 300 s).
- `POST /api/auth/server-token` — exchanges an identity token for a
  short-lived (default 600 s, `SERVER_TOKEN_TTL`) token scoped to ONE chat
  server via its `aud` claim, embedding `preferred_username` and `avatar_url`.
  Chat servers only accept tokens addressed to their own origin
  (`SERVER_PUBLIC_ORIGIN`); the Federation and Social reject server-scoped
  tokens. A harvested server token is useless elsewhere and dies in minutes.

### Migration notes (self-hosters)
- **Federation:** set `JWT_PRIVATE_KEY` and `PUBLIC_URL`; remove `JWT_SECRET`.
- **Chat servers:** set `SERVER_PUBLIC_ORIGIN` to the exact public address
  users connect with, and `FEDERATION_URL`; remove `JWT_SECRET`.
- **Social:** set `FEDERATION_URL`; remove `JWT_SECRET`.
- **Clients:** exchange the identity token per server via
  `POST /api/auth/server-token` before any server REST call or socket connect.

---
## [2026-03-14] Client platform field + graceful offline presence

**Changed — WebSocket handshake**
- Added optional `platform` field to the `auth` handshake object: `'desktop'` | `'web'` | `'mobile_web'`. Unrecognised or missing values default to `'web'`.
- Platform is tracked server-side in a per-session in-memory registry for the duration of the connection.

**Changed — Offline behaviour**
- When a user's last socket disconnects (clean close or heartbeat timeout), the Federation now waits an **8-second grace period** before writing `status = 'offline'` to the DB and emitting `status_change`. Reconnecting within that window (e.g. page reload) cancels the timer — no offline flap occurs.
- If the user has multiple concurrent sessions (multiple tabs/devices), going offline on one session does not affect others.

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
