-- Notes, sharing preferences, client detail invites, reminders and one-step undo.
-- Health details stay on diet_profile. Organisers do not read that table.

ALTER TABLE group_attendee ADD COLUMN IF NOT EXISTS client_note text NOT NULL DEFAULT '';
ALTER TABLE group_attendee ADD COLUMN IF NOT EXISTS share_with_person_id uuid REFERENCES person(id) ON DELETE SET NULL;
ALTER TABLE group_attendee ADD COLUMN IF NOT EXISTS single_occupancy boolean NOT NULL DEFAULT false;
ALTER TABLE group_attendee ADD COLUMN IF NOT EXISTS details_submitted_at timestamptz;
ALTER TABLE group_attendee ADD COLUMN IF NOT EXISTS preferred_room_id uuid REFERENCES room(id) ON DELETE SET NULL;
ALTER TABLE group_attendee ADD COLUMN IF NOT EXISTS is_organiser boolean NOT NULL DEFAULT false;
ALTER TABLE group_attendee DROP CONSTRAINT IF EXISTS group_attendee_note_len;
ALTER TABLE group_attendee ADD CONSTRAINT group_attendee_note_len CHECK (char_length(client_note) <= 200);

ALTER TABLE room_occupancy ADD COLUMN IF NOT EXISTS assign_source text NOT NULL DEFAULT 'manual';
ALTER TABLE room_occupancy ADD COLUMN IF NOT EXISTS assign_locked boolean NOT NULL DEFAULT false;
ALTER TABLE room_occupancy DROP CONSTRAINT IF EXISTS room_occupancy_assign_source;
ALTER TABLE room_occupancy ADD CONSTRAINT room_occupancy_assign_source CHECK (assign_source IN ('manual', 'auto'));

CREATE TABLE IF NOT EXISTS client_detail_invite (
  token_hash text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  group_id uuid NOT NULL REFERENCES booking_group(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES person(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_detail_invite_person_idx ON client_detail_invite (group_id, person_id);

CREATE TABLE IF NOT EXISTS organiser_room_reminder (
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  group_id uuid NOT NULL REFERENCES booking_group(id) ON DELETE CASCADE,
  offset_days integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('organiser', 'staff')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, offset_days, kind)
);

CREATE TABLE IF NOT EXISTS group_room_undo (
  group_id uuid PRIMARY KEY REFERENCES booking_group(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  placements jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
