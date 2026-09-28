-- Shuttle runs. Travel times are clustered. Nothing here takes a payment.

CREATE TABLE IF NOT EXISTS shuttle_service (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  code text NOT NULL,
  name text NOT NULL,
  route text NOT NULL,
  capacity integer NOT NULL DEFAULT 8,
  driver text NOT NULL DEFAULT '',
  travel_minutes integer NOT NULL DEFAULT 25,
  meeting_point text NOT NULL DEFAULT '',
  window_minutes integer NOT NULL DEFAULT 45,
  UNIQUE (property_id, code)
);

CREATE TABLE IF NOT EXISTS travel_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  group_id uuid NOT NULL REFERENCES booking_group(id) ON DELETE CASCADE,
  person_id uuid REFERENCES person(id),
  person_key text NOT NULL,
  guest_name text NOT NULL DEFAULT '',
  group_name text NOT NULL DEFAULT '',
  direction text NOT NULL CHECK (direction IN ('arrival', 'departure')),
  mode text NOT NULL CHECK (mode IN ('shuttle', 'own_car', 'taxi', 'lift', 'other')),
  train_time text,
  party integer NOT NULL DEFAULT 1,
  access text[] NOT NULL DEFAULT '{}',
  on_date date NOT NULL,
  UNIQUE (group_id, person_key, direction)
);

CREATE TABLE IF NOT EXISTS shuttle_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  service_id uuid NOT NULL REFERENCES shuttle_service(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('arrival', 'departure')),
  on_date date NOT NULL,
  pickup_time text NOT NULL,
  meeting_point text NOT NULL,
  train_from text NOT NULL,
  train_to text NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  overflow boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS shuttle_seat (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES shuttle_run(id) ON DELETE CASCADE,
  person_key text NOT NULL,
  guest_name text NOT NULL,
  party integer NOT NULL DEFAULT 1,
  group_id uuid,
  group_name text NOT NULL DEFAULT '',
  access text[] NOT NULL DEFAULT '{}',
  mark text NOT NULL DEFAULT 'expected' CHECK (mark IN ('expected', 'picked_up', 'no_show')),
  UNIQUE (run_id, person_key)
);
