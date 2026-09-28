-- Guest communication preferences. Marketing stays off until the guest opts in.
-- The house switch lives in property settings and defaults to off.
-- Held letters use the existing outbound email log. The 15-minute mail job releases them.

CREATE TABLE IF NOT EXISTS guest_comms_pref (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  email text NOT NULL,
  operational_channel text NOT NULL DEFAULT 'email' CHECK (operational_channel IN ('email', 'sms', 'none')),
  marketing boolean NOT NULL DEFAULT false,
  marketing_channel text NOT NULL DEFAULT 'none' CHECK (marketing_channel IN ('email', 'sms', 'none')),
  quiet_from text NOT NULL DEFAULT '22:00',
  quiet_to text NOT NULL DEFAULT '07:00',
  consent_at timestamptz,
  consent_source text,
  wording_version text,
  wording text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, email)
);

CREATE TABLE IF NOT EXISTS guest_comms_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  email text NOT NULL,
  marketing boolean NOT NULL,
  source text NOT NULL,
  wording_version text NOT NULL,
  wording text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE outbound_email ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'email';
ALTER TABLE outbound_email ADD COLUMN IF NOT EXISTS not_before timestamptz;
ALTER TABLE outbound_email ADD COLUMN IF NOT EXISTS hold_reason text;
ALTER TABLE outbound_email ADD COLUMN IF NOT EXISTS guest_email text;

DO $$
DECLARE cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  WHERE con.conrelid = 'outbound_email'::regclass
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%LOGGED%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE outbound_email DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE outbound_email DROP CONSTRAINT IF EXISTS outbound_email_status_check;
ALTER TABLE outbound_email
  ADD CONSTRAINT outbound_email_status_check
  CHECK (status IN ('QUEUED', 'SENT', 'FAILED', 'LOGGED', 'SKIPPED', 'DEFERRED'));

INSERT INTO permission (code, description) VALUES
  ('comms.prefs', 'Switch guest communication preferences on')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'comms.prefs' FROM role r
WHERE r.code IN ('SYSTEM_OWNER', 'GENERAL_MANAGER')
ON CONFLICT DO NOTHING;
