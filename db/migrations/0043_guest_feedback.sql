-- Post-stay feedback. One invite per booking. Free text is personal data.
-- CAPA did not exist on this branch, so the corrective action lives here and links back to the stay.

CREATE TABLE IF NOT EXISTS guest_feedback_invite (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  group_id uuid NOT NULL REFERENCES booking_group(id) ON DELETE CASCADE,
  person_id uuid REFERENCES person(id),
  guest_account_id uuid REFERENCES guest_account(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  sent_at timestamptz,
  used_at timestamptz,
  email_status text,
  sms_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id)
);

CREATE TABLE IF NOT EXISTS guest_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id uuid NOT NULL UNIQUE REFERENCES guest_feedback_invite(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  group_id uuid NOT NULL REFERENCES booking_group(id) ON DELETE CASCADE,
  person_id uuid REFERENCES person(id),
  guest_account_id uuid REFERENCES guest_account(id),
  first_name text,
  food_score smallint NOT NULL CHECK (food_score BETWEEN 1 AND 5),
  room_score smallint NOT NULL CHECK (room_score BETWEEN 1 AND 5),
  overall_score smallint NOT NULL CHECK (overall_score BETWEEN 1 AND 5),
  comment text,
  problem boolean NOT NULL DEFAULT false,
  problem_category text CHECK (problem_category IN ('food','room','staff','other')),
  problem_detail text,
  maintenance_ticket_id uuid REFERENCES maintenance_ticket(id),
  complaint_id uuid REFERENCES guest_complaint(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  anonymised_at timestamptz
);

CREATE INDEX IF NOT EXISTS guest_feedback_property_idx ON guest_feedback (property_id, created_at DESC);

CREATE TABLE IF NOT EXISTS capa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id uuid NOT NULL UNIQUE REFERENCES guest_feedback(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','action_taken','verified','closed')),
  owner_user_id uuid REFERENCES app_user(id),
  root_cause text,
  corrective_action text,
  preventive_action text,
  due_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS capa_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capa_id uuid NOT NULL REFERENCES capa(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  from_status text,
  to_status text,
  note text,
  by_user_id uuid REFERENCES app_user(id),
  by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS capa_event_capa_idx ON capa_event (capa_id, created_at);
