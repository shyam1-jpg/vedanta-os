-- Lost property matcher. The house switch lives in property.settings.lost_found.matcher and defaults to off.
-- Photos stay in these tables. Public pages never receive them.
-- Personal details are cleared when a case is closed, and again after the purge period when the matcher is on.

ALTER TABLE lost_report ADD COLUMN IF NOT EXISTS contact_consent boolean NOT NULL DEFAULT false;
ALTER TABLE lost_report ADD COLUMN IF NOT EXISTS consent_at timestamptz;
ALTER TABLE lost_report ADD COLUMN IF NOT EXISTS photo text;
ALTER TABLE lost_report ADD COLUMN IF NOT EXISTS purged_at timestamptz;

ALTER TABLE lost_item ADD COLUMN IF NOT EXISTS purged_at timestamptz;

DO $$
DECLARE cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  WHERE con.conrelid = 'lost_item'::regclass
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%logged%matched%claimed%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE lost_item DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE lost_item DROP CONSTRAINT IF EXISTS lost_item_status_chk;
ALTER TABLE lost_item
  ADD CONSTRAINT lost_item_status_chk
  CHECK (status IN ('logged', 'matched', 'claimed', 'returned', 'disposed', 'donated', 'expired'));

CREATE TABLE IF NOT EXISTS lost_notice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  item_id uuid REFERENCES lost_item(id) ON DELETE CASCADE,
  report_id uuid REFERENCES lost_report(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email', 'sms', 'none')),
  status text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lost_notice_item_idx ON lost_notice (item_id, created_at DESC);
