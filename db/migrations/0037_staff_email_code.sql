-- Short-lived, one-use staff email codes. Never store the plaintext code.
CREATE TABLE staff_email_code (
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  surface text NOT NULL CHECK (surface IN ('ADMIN', 'STAFF')),
  code_hash text NOT NULL,
  salt text NOT NULL,
  expires_at timestamptz NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, surface)
);
