# Concordia Federation — API Reference

Base URL: `http://localhost:3000` (configure `PORT` in `.env`)

All request and response bodies are JSON. Successful responses include a `Content-Type: application/json` header.

---

## Health Check

### `GET /health`

Confirms the server is running.

**Response `200 OK`**
```json
{ "status": "ok" }
```

---

## Auth

All auth endpoints are prefixed with `/api/auth`.

---

### `POST /api/auth/register`

Creates a new user account. Returns a signed JWT on success.

#### Request body

| Field      | Type   | Required | Rules |
|------------|--------|----------|-------|
| `username` | string | Yes | 3–50 characters. Letters, numbers, `_`, and `-` only. |
| `email`    | string | Yes | Must be a valid email address. |
| `password` | string | Yes | Minimum 8 characters, at least one uppercase letter and one number. |

```json
{
  "username": "petersmith",
  "email": "peter@example.com",
  "password": "Secret123"
}
```

#### Responses

**`201 Created`** — account created successfully.
```json
{
  "message": "Account created successfully.",
  "token": "<jwt>",
  "user": {
    "id": 1,
    "username": "petersmith",
    "email": "peter@example.com",
    "created_at": "2026-02-26T12:00:00.000Z"
  }
}
```

**`400 Bad Request`** — one or more fields failed validation.
```json
{
  "errors": [
    { "field": "password", "message": "Password must be at least 8 characters long." },
    { "field": "email",    "message": "A valid email address is required." }
  ]
}
```

**`409 Conflict`** — username or email is already registered.
```json
{ "error": "That email is already in use." }
```

**`500 Internal Server Error`**
```json
{ "error": "Internal server error." }
```

---

### `POST /api/auth/login`

Authenticates an existing user. Returns a signed JWT on success.

#### Request body

| Field      | Type   | Required |
|------------|--------|----------|
| `email`    | string | Yes |
| `password` | string | Yes |

```json
{
  "email": "peter@example.com",
  "password": "Secret123"
}
```

#### Responses

**`200 OK`** — login successful.
```json
{
  "message": "Login successful.",
  "token": "<jwt>",
  "user": {
    "id": 1,
    "username": "petersmith",
    "email": "peter@example.com"
  }
}
```

**`400 Bad Request`** — missing or malformed fields.
```json
{
  "errors": [
    { "field": "email", "message": "A valid email address is required." }
  ]
}
```

**`401 Unauthorized`** — email not found or password incorrect.
```json
{ "error": "Invalid email or password." }
```

> Note: the same message is returned for both an unrecognised email and a wrong password to prevent user enumeration.

**`500 Internal Server Error`**
```json
{ "error": "Internal server error." }
```

---

## Authentication

Protected routes (to be added) expect a JWT in the `Authorization` header:

```
Authorization: Bearer <token>
```

Tokens expire after the duration set in `JWT_EXPIRES_IN` (default `7d`). When a token expires the client should redirect the user to login again.

---

## Database schema

```
users
├── id             SERIAL PRIMARY KEY
├── username       VARCHAR(50)  UNIQUE NOT NULL
├── email          VARCHAR(255) UNIQUE NOT NULL
├── password_hash  VARCHAR(255) NOT NULL          ← bcrypt hash, never plaintext
├── created_at     TIMESTAMPTZ  DEFAULT NOW()
└── updated_at     TIMESTAMPTZ  DEFAULT NOW()     ← auto-updated via trigger
```
