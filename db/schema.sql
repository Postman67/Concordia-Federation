-- Last updated: March 7, 2026 8:15 PM PST
-- Run this script once to set up the database schema.
-- psql -U <user> -d <database> -f db/schema.sql

-- ─── Users ────────────────────────────────────────────────────────────────────
-- Core identity. The Federation is the sole authentication authority.

CREATE TABLE IF NOT EXISTS users (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  username       VARCHAR(50)  UNIQUE NOT NULL,
  email          VARCHAR(255) UNIQUE NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    JOIN pg_class ON pg_class.oid = pg_trigger.tgrelid
    WHERE pg_trigger.tgname = 'users_set_updated_at'
      AND pg_class.relname  = 'users'
  ) THEN
    CREATE TRIGGER users_set_updated_at
      BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

-- ─── User Settings ────────────────────────────────────────────────────────────
-- Globally synced across every client the user logs into.
-- One row per user, created on first login/register.

CREATE TABLE IF NOT EXISTS user_settings (
  user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name  VARCHAR(100),
  avatar_url    VARCHAR(500),
  banner_url    VARCHAR(500),
  bio           VARCHAR(500),
  profile_link  VARCHAR(500),
  theme         VARCHAR(20)  NOT NULL DEFAULT 'dark',
  status        VARCHAR(20)  NOT NULL DEFAULT 'offline'
                             CHECK (status IN ('online','idle','dnd','invisible','offline')),
  custom_status VARCHAR(100),
  custom_status_expires_at TIMESTAMP WITH TIME ZONE,
  last_seen     TIMESTAMP WITH TIME ZONE,
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Migration: add columns to existing deployments
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS status        VARCHAR(20)  NOT NULL DEFAULT 'offline'
                                         CHECK (status IN ('online','idle','dnd','invisible','offline')),
  ADD COLUMN IF NOT EXISTS last_seen     TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS banner_url    VARCHAR(500),
  ADD COLUMN IF NOT EXISTS bio           VARCHAR(500),
  ADD COLUMN IF NOT EXISTS profile_link  VARCHAR(500),
  ADD COLUMN IF NOT EXISTS custom_status VARCHAR(100),
  ADD COLUMN IF NOT EXISTS custom_status_expires_at TIMESTAMP WITH TIME ZONE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    JOIN pg_class ON pg_class.oid = pg_trigger.tgrelid
    WHERE pg_trigger.tgname = 'user_settings_set_updated_at'
      AND pg_class.relname  = 'user_settings'
  ) THEN
    CREATE TRIGGER user_settings_set_updated_at
      BEFORE UPDATE ON user_settings
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

-- ─── User Servers ─────────────────────────────────────────────────────────────
-- The list of Concordia servers a user has added, stored in the Federation.
-- No personal user data is ever sent to the servers themselves — only user_id.

CREATE TABLE IF NOT EXISTS user_servers (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_address VARCHAR(255) NOT NULL,            -- IP or domain:port
  server_name    VARCHAR(100),                     -- pushed by the client from the server itself
  position       INTEGER NOT NULL DEFAULT 0,       -- sidebar order
  added_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (user_id, server_address)
);

-- ─── Federation Metrics ──────────────────────────────────────────────────────
-- Append-only event log. Rows older than 90 days are pruned automatically by
-- GET /api/admin/metrics on each fetch.

CREATE TABLE IF NOT EXISTS federation_events (
  id          BIGSERIAL    PRIMARY KEY,
  event_type  VARCHAR(30)  NOT NULL,           -- login_success | login_fail | user_registered
  occurred_at TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fed_events_type_date
  ON federation_events (event_type, occurred_at);

-- Lifetime counters — survive the 90-day event prune.
CREATE TABLE IF NOT EXISTS federation_counters (
  key    VARCHAR(50) PRIMARY KEY,
  value  BIGINT NOT NULL DEFAULT 0
);

INSERT INTO federation_counters (key, value)
  VALUES ('login_success', 0), ('login_fail', 0), ('user_registered', 0)
  ON CONFLICT (key) DO NOTHING;

-- ─── Security hardening (2026-07-19) ─────────────────────────────────────────
-- Refresh-token rotation, jti revocation, email verification, password reset,
-- login lockout, and TOTP 2FA.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Rotating refresh tokens. Only the SHA-256 of the token is stored.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   CHAR(64) NOT NULL UNIQUE,           -- sha256 hex
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at   TIMESTAMPTZ,
  replaced_by  UUID REFERENCES refresh_tokens(id)  -- rotation chain
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id);

-- Immediate revocation of outstanding identity tokens (logout, admin action).
-- Rows are prunable once expires_at passes.
CREATE TABLE IF NOT EXISTS revoked_jtis (
  jti        UUID PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revoked_jtis_expiry ON revoked_jtis (expires_at);

-- One-time email action tokens (verification, password reset). Hash-only.
CREATE TABLE IF NOT EXISTS email_tokens (
  token_hash CHAR(64) PRIMARY KEY,                 -- sha256 hex
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    VARCHAR(20) NOT NULL CHECK (purpose IN ('verify', 'reset')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens (user_id, purpose);

-- Per-account login lockout (backs the per-IP rate limiter).
CREATE TABLE IF NOT EXISTS auth_failures (
  email        VARCHAR(255) PRIMARY KEY,
  fail_count   INTEGER NOT NULL DEFAULT 0,
  last_fail_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until TIMESTAMPTZ
);

-- TOTP 2FA. Secret is base32; backup codes stored as sha256 hashes.
CREATE TABLE IF NOT EXISTS user_mfa (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret       VARCHAR(64) NOT NULL,
  enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  backup_codes JSONB NOT NULL DEFAULT '[]',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
