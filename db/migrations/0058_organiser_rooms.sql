-- Organiser access codes and the rooms held for a retreat group.
-- Assignments themselves stay on room_occupancy (person_id + occupant_label).
-- A hold is not an occupant: it must not consume a bed.

CREATE TABLE organiser_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  group_id uuid NOT NULL REFERENCES booking_group(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX organiser_access_live_idx ON organiser_access (group_id) WHERE revoked_at IS NULL;

CREATE TABLE organiser_session (
  token text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  group_ids uuid[] NOT NULL CHECK (cardinality(group_ids) >= 1),
  expires_at timestamptz NOT NULL,
  kind text NOT NULL CHECK (kind IN ('code', 'form', 'guest')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE group_room_hold (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  group_id uuid NOT NULL REFERENCES booking_group(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES room(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, room_id)
);
CREATE INDEX group_room_hold_room_idx ON group_room_hold (room_id);

ALTER TABLE group_attendee ADD COLUMN IF NOT EXISTS share_consent boolean NOT NULL DEFAULT false;
ALTER TABLE group_attendee ADD COLUMN IF NOT EXISTS needs_access boolean NOT NULL DEFAULT false;
