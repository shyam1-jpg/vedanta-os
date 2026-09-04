-- Migration 0026: guest email OTP — magic-link verification for My Stay
-- Instead of showing the access code on-screen and hoping the guest copies it,
-- the code is emailed and the link in the email verifies the guest's address.
-- Adds: email_verified flag on guest_account, otp_token table for magic links.

ALTER TABLE guest_account
  ADD COLUMN IF NOT EXISTS email_verified     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_verified_at  timestamptz;

-- One-time tokens for email verification and passwordless magic links
CREATE TABLE IF NOT EXISTS guest_otp (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  property_id   uuid NOT NULL REFERENCES property(id),
  guest_id      uuid NOT NULL REFERENCES guest_account(id) ON DELETE CASCADE,
  token_hash    text NOT NULL,          -- SHA-256 of the raw token
  kind          text NOT NULL,          -- 'verify_email' | 'magic_link' | 'access_code_reset'
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  ip_address    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS guest_otp_guest ON guest_otp (guest_id, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS guest_otp_token ON guest_otp (token_hash);
