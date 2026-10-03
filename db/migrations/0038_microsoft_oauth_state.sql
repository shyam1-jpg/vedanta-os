-- Short-lived Microsoft sign-in attempts. The PKCE verifier is a secret: do not log this table.
-- Any API process can finish the Entra callback, including after a restart.
-- Rows are single-use and expire after 10 minutes.

CREATE TABLE microsoft_oauth_state (
  state text PRIMARY KEY,
  verifier text NOT NULL,
  surface text NOT NULL CHECK (surface IN ('ADMIN', 'STAFF')),
  expires_at timestamptz NOT NULL
);

CREATE INDEX microsoft_oauth_state_expires_at ON microsoft_oauth_state (expires_at);
