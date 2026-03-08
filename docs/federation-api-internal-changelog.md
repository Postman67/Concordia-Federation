# Concordia Federation — Internal API Changelog

> Format: `[YYYY-MM-DD HH:MM TZ] Summary`

---

## [2026-03-07 — Initial Internal API]

**Added**

- `GET /api/internal/users/search?q=<prefix>` — username-prefix search for use by Concordia-Social and other first-party services. Returns up to 25 matches ordered alphabetically.
- `GET /api/internal/users/:id` — fetch full public profile by Federation UUID.

Both endpoints return: `id`, `username`, `display_name`, `avatar_url`, `banner_url`, `bio`, `status`, `profile_link`.

**New files**
- `src/middleware/requireInternal.js` — validates the `X-Internal-Key` shared secret header
- `src/controllers/internalController.js` — `searchUsers`, `getUserById`
- `src/routes/internal.js` — mounted at `/api/internal`

**Config**
- Added `INTERNAL_API_KEY` to `.env.example`
