-- Lost property return: match decisions, guest links, collection signatures, disposal holds.
-- Guest contact and the postage address are cleared when the case closes.

ALTER TABLE lost_item ADD COLUMN IF NOT EXISTS reference text;
ALTER TABLE lost_item ADD COLUMN IF NOT EXISTS signature text;
ALTER TABLE lost_item ADD COLUMN IF NOT EXISTS notified_at timestamptz;
ALTER TABLE lost_item ADD COLUMN IF NOT EXISTS disposal_hold_until date;
ALTER TABLE lost_item ADD COLUMN IF NOT EXISTS disposal_reason text;
ALTER TABLE lost_item ADD COLUMN IF NOT EXISTS donate_to text;
ALTER TABLE lost_item ADD COLUMN IF NOT EXISTS disposal_alerted_at timestamptz;

UPDATE lost_item
SET reference = 'LF-' || upper(substr(replace(id::text, '-', ''), 1, 8))
WHERE reference IS NULL;

ALTER TABLE lost_report ADD COLUMN IF NOT EXISTS booking_ref text;
ALTER TABLE lost_report ADD COLUMN IF NOT EXISTS rejected_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE lost_report ADD COLUMN IF NOT EXISTS notified_at timestamptz;
ALTER TABLE lost_report ADD COLUMN IF NOT EXISTS guest_choice text;
ALTER TABLE lost_report ADD COLUMN IF NOT EXISTS guest_choice_detail text;
ALTER TABLE lost_report ADD COLUMN IF NOT EXISTS choice_at timestamptz;

ALTER TABLE lost_report DROP CONSTRAINT IF EXISTS lost_report_guest_choice_chk;
ALTER TABLE lost_report ADD CONSTRAINT lost_report_guest_choice_chk
  CHECK (guest_choice IS NULL OR guest_choice IN ('collection', 'postage'));

CREATE TABLE IF NOT EXISTS lost_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  report_id uuid NOT NULL REFERENCES lost_report(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES lost_item(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lost_link_report_idx ON lost_link (report_id, expires_at DESC);
