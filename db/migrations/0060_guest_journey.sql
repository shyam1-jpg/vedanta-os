-- Guest journey: one send log, stay links, and digital check-in.
-- Service letters are not marketing. Rebook needs the consent already stored on guest_profile.

ALTER TABLE guest_profile ADD COLUMN IF NOT EXISTS unsubscribed_at timestamptz;

CREATE TABLE IF NOT EXISTS guest_journey_send (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  group_id uuid NOT NULL REFERENCES booking_group(id) ON DELETE CASCADE,
  person_key text NOT NULL DEFAULT '',
  person_id uuid REFERENCES person(id),
  kind text NOT NULL,
  variant text,
  channel text NOT NULL CHECK (channel IN ('service', 'marketing')),
  to_email text,
  status text NOT NULL DEFAULT 'LOGGED',
  sms_status text,
  outbound_email_id uuid,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, person_key, kind)
);

CREATE INDEX IF NOT EXISTS guest_journey_send_property_idx ON guest_journey_send (property_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS guest_journey_link (
  token_hash text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  group_id uuid NOT NULL REFERENCES booking_group(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES person(id),
  purpose text NOT NULL CHECK (purpose IN ('stay', 'details', 'unsubscribe')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guest_check_in (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  group_id uuid NOT NULL REFERENCES booking_group(id) ON DELETE CASCADE,
  person_id uuid REFERENCES person(id),
  walk_up_name text,
  status text NOT NULL DEFAULT 'expected' CHECK (status IN ('expected', 'en_route', 'checked_in_digitally', 'arrived', 'keys_issued')),
  arrival_time text,
  emergency_name text,
  emergency_phone text,
  emergency_until date,
  rules_ack boolean NOT NULL DEFAULT false,
  id_ack boolean NOT NULL DEFAULT false,
  room_released boolean NOT NULL DEFAULT false,
  expected_at timestamptz,
  en_route_at timestamptz,
  checked_in_at timestamptz,
  arrived_at timestamptz,
  keys_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS guest_check_in_person_idx ON guest_check_in (group_id, person_id) WHERE person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS guest_check_in_property_idx ON guest_check_in (property_id, status);
