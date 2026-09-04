-- Migration 0036: Guest OTP verification — ensure email_verified column exists
-- and add outbound_email tracking for OTP emails

ALTER TABLE guest_account
  ADD COLUMN IF NOT EXISTS email_verified     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_verified_at  timestamptz;

-- Create OTP table if not already created in 0026
CREATE TABLE IF NOT EXISTS guest_otp (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  property_id   uuid NOT NULL REFERENCES property(id),
  guest_id      uuid NOT NULL REFERENCES guest_account(id) ON DELETE CASCADE,
  token_hash    text NOT NULL,
  kind          text NOT NULL,  -- 'verify_email' | 'magic_link' | 'access_code_reset'
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  ip_address    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS guest_otp_token ON guest_otp (token_hash);
CREATE INDEX IF NOT EXISTS guest_otp_guest ON guest_otp (guest_id, expires_at);
