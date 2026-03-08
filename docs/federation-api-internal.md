# Concordia Federation — Internal API Reference

> Last updated: March 7, 2026

> These endpoints are **not public**. They are intended exclusively for first-party
> Concordia services (e.g. Concordia-Social) communicating with the Federation
> over the internal network. Never expose `/api/internal/*` through a public-facing
> proxy without additional access controls.

Base URL: `https://federation.concordiachat.com` (local: `http://localhost:3000`)

All request and response bodies are JSON.

---

## Authentication

Every request to `/api/internal/*` must include the shared secret in a header:

```
X-Internal-Key: <INTERNAL_API_KEY>
```

The value must exactly match the `INTERNAL_API_KEY` environment variable set on the
Federation server. If the header is absent or incorrect the server returns `401`.

This secret is configured once per deployment and shared out-of-band with each
authorised service.

---

## Users — `/api/internal/users`

### `GET /api/internal/users/search`

Search for users by username prefix. Usernames are unique handles (equivalent to
`@handle`), so matching on username alone is unambiguous.

Returns up to **25** results ordered alphabetically by username.

**Query parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `q` | string | ✅ | Username prefix to search for (case-insensitive) |

**Example request**

```
GET /api/internal/users/search?q=peter
X-Internal-Key: <key>
```

**Response `200`**

```json
{
  "users": [
    {
      "id": "018e1b2c-...",
      "username": "peter",
      "display_name": "Peter",
      "avatar_url": "https://cdn.example.com/avatars/peter.webp",
      "banner_url": null,
      "bio": "Building Concordia.",
      "status": "online",
      "profile_link": "https://github.com/Postman67"
    }
  ]
}
```

`users` is an empty array `[]` when no usernames match the prefix.

**Response `400`** — missing or empty `q` parameter

```json
{ "error": "Query parameter \"q\" is required." }
```

**Response `401`** — missing or invalid `X-Internal-Key`

```json
{ "error": "Internal authentication required." }
```

---

### `GET /api/internal/users/:id`

Fetch the full public profile for a single user by their Federation UUID.

**Path parameters**

| Parameter | Type | Description |
|---|---|---|
| `id` | UUID | The user's Federation `id` |

**Example request**

```
GET /api/internal/users/018e1b2c-3d4e-5f67-8901-abcdef012345
X-Internal-Key: <key>
```

**Response `200`**

```json
{
  "user": {
    "id": "018e1b2c-3d4e-5f67-8901-abcdef012345",
    "username": "peter",
    "display_name": "Peter",
    "avatar_url": "https://cdn.example.com/avatars/peter.webp",
    "banner_url": null,
    "bio": "Building Concordia.",
    "status": "online",
    "profile_link": "https://github.com/Postman67"
  }
}
```

**Response `404`** — no user with that UUID

```json
{ "error": "User not found." }
```

**Response `401`** — missing or invalid `X-Internal-Key`

```json
{ "error": "Internal authentication required." }
```

---

## Public profile fields

| Field | Source | Description |
|---|---|---|
| `id` | `users.id` | Federation UUID |
| `username` | `users.username` | Unique `@handle` |
| `display_name` | `user_settings.display_name` | Chosen display name (may be `null`) |
| `avatar_url` | `user_settings.avatar_url` | Avatar image URL (may be `null`) |
| `banner_url` | `user_settings.banner_url` | Profile banner URL (may be `null`) |
| `bio` | `user_settings.bio` | Short biography (may be `null`) |
| `status` | `user_settings.status` | `online` \| `idle` \| `dnd` \| `invisible` \| `offline` |
| `profile_link` | `user_settings.profile_link` | External link shown on profile (may be `null`) |

Fields sourced from `user_settings` are `null` if the user has never saved settings.

---

## Deployment Notes

- Set `INTERNAL_API_KEY` via your Railway (or equivalent) environment variables panel.
- Generate a secure value with: `openssl rand -hex 32`
- Rotate the key by updating the env var on all services simultaneously and redeploying.
- This key is **not** the admin UUID and **not** the JWT secret — it is separate.
