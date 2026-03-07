-- Run this script once to set up the database schema.
-- psql -U <user> -d <database> -f db/schema.sql

-- ─── Users ────────────────────────────────────────────────────────────────────
-- Core identity. The Federation is the sole authentication authority.

CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
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
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name  VARCHAR(100),
  avatar_url    VARCHAR(500),
  theme         VARCHAR(20)  NOT NULL DEFAULT 'dark',
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

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
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_address VARCHAR(255) NOT NULL,            -- IP or domain:port
  nickname       VARCHAR(100),                     -- optional user-given label
  position       INTEGER NOT NULL DEFAULT 0,       -- sidebar order
  added_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (user_id, server_address)
);
