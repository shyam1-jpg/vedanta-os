-- Additive arrival milestones. Never changes bookings, room occupancy or key access.
CREATE TABLE IF NOT EXISTS guest_arrival_registration (
  enquiry_id uuid PRIMARY KEY REFERENCES guest_enquiry(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  stay_arrival date NOT NULL,
  stay_departure date NOT NULL,
  details_hash text NOT NULL,
  details_confirmed_at timestamptz NOT NULL DEFAULT now(),
  arrived_at timestamptz,
  reception_seen_at timestamptz,
  reception_seen_by uuid REFERENCES app_user(id),
  CHECK (stay_departure >= stay_arrival),
  CHECK (reception_seen_at IS NULL OR arrived_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS guest_arrival_property_idx
  ON guest_arrival_registration(property_id, stay_arrival);
