-- Migration 0025: session management — device tracking, sign-in history, forced logout
-- Adds: device fingerprint on sessions, sign_in_event audit log, active session list per user,
--       revoke-all-sessions command, session name (browser/device label).

-- 1. Extend the session table with device info
ALTER TABLE session
  ADD COLUMN IF NOT EXISTS device_label   text,          -- e.g. "Chrome on Windows"
  ADD COLUMN IF NOT EXISTS ip_address     text,
  ADD COLUMN IF NOT EXISTS user_agent     text,
  ADD COLUMN IF NOT EXISTS last_seen_at   timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS revoked_at     timestamptz;

-- Index for listing a user's sessions quickly
CREATE INDEX IF NOT EXISTS session_user_active
  ON session (user_id, expires_at)
  WHERE revoked_at IS NULL;

-- 2. Sign-in history log
CREATE TABLE IF NOT EXISTS sign_in_event (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  user_id       uuid NOT NULL REFERENCES app_user(id),
  property_id   uuid REFERENCES property(id),
  provider      text NOT NULL,   -- 'microsoft' | 'email' | 'dev'
  ip_address    text,
  user_agent    text,
  device_label  text,
  success       boolean NOT NULL DEFAULT true,
  failure_reason text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sign_in_event_user ON sign_in_event (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sign_in_event_tenant ON sign_in_event (tenant_id, created_at DESC);

-- 3. Guest session gets the same device columns
ALTER TABLE guest_session
  ADD COLUMN IF NOT EXISTS device_label   text,
  ADD COLUMN IF NOT EXISTS ip_address     text,
  ADD COLUMN IF NOT EXISTS user_agent     text,
  ADD COLUMN IF NOT EXISTS last_seen_at   timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS revoked_at     timestamptz;
