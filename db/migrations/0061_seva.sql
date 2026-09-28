-- Seva slots. Placeholder animal names only. Real names belong in a local seed, not this file.

CREATE TABLE IF NOT EXISTS seva_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  code text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('kitchen_help', 'gardening', 'cow_care', 'other')),
  description text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  duration_minutes integer NOT NULL DEFAULT 60,
  capacity integer NOT NULL DEFAULT 4,
  min_age integer NOT NULL DEFAULT 16,
  supervisor_role text NOT NULL DEFAULT '',
  safety_notes text NOT NULL DEFAULT '',
  waiver_required boolean NOT NULL DEFAULT false,
  waiver_text text NOT NULL DEFAULT '',
  tasks text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  UNIQUE (property_id, code)
);

CREATE TABLE IF NOT EXISTS seva_animal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  code text NOT NULL,
  name text NOT NULL,
  audience text NOT NULL CHECK (audience IN ('guest', 'staff')),
  note text NOT NULL DEFAULT '',
  UNIQUE (property_id, code)
);

CREATE TABLE IF NOT EXISTS seva_slot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  activity_id uuid NOT NULL REFERENCES seva_activity(id) ON DELETE CASCADE,
  on_date date NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  capacity integer NOT NULL,
  supervisor_name text,
  UNIQUE (activity_id, on_date, start_time)
);

CREATE TABLE IF NOT EXISTS seva_booking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  slot_id uuid NOT NULL REFERENCES seva_slot(id) ON DELETE CASCADE,
  person_id uuid REFERENCES person(id),
  person_key text NOT NULL,
  guest_name text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('booked', 'waitlist', 'cancelled')),
  animal_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slot_id, person_key)
);

CREATE INDEX IF NOT EXISTS seva_slot_day_idx ON seva_slot (property_id, on_date);
