-- Extend the existing maintenance ticket: equipment, photo, food-safety flag,
-- an acknowledged step, and notes. Areas and inboxes live in property settings.

DO $$
DECLARE cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  WHERE con.conrelid = 'maintenance_ticket'::regclass
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%IN_PROGRESS%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE maintenance_ticket DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE maintenance_ticket
  ADD CONSTRAINT maintenance_ticket_status_check
  CHECK (status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS','WAITING_PARTS','DONE','CANCELLED'));

ALTER TABLE maintenance_ticket
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES asset(id),
  ADD COLUMN IF NOT EXISTS equipment_label text,
  ADD COLUMN IF NOT EXISTS equipment_category text,
  ADD COLUMN IF NOT EXISTS photo text,
  ADD COLUMN IF NOT EXISTS food_safety boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS maintenance_room_hist_idx ON maintenance_ticket (property_id, room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS maintenance_asset_hist_idx ON maintenance_ticket (property_id, asset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS maintenance_note (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES maintenance_ticket(id),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  author_user_id uuid REFERENCES app_user(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS maintenance_note_ticket_idx ON maintenance_note (ticket_id, created_at);
