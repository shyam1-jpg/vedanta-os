-- One-time codes that prove a guest can read the email they typed
-- before My Stay is created. The plaintext code is never stored.
-- guest_otp cannot hold this challenge: it requires an existing guest_account.
CREATE TABLE guest_email_code (
  email text PRIMARY KEY,
  code_hash text NOT NULL,
  salt text NOT NULL,
  expires_at timestamptz NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  CHECK (attempts >= 0)
);
