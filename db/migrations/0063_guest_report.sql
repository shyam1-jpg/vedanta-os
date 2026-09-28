-- A guest report is a maintenance ticket, plus the guest's own status line.

CREATE TABLE IF NOT EXISTS guest_report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  group_id uuid NOT NULL REFERENCES booking_group(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES person(id),
  ticket_id uuid NOT NULL REFERENCES maintenance_ticket(id),
  category text NOT NULL,
  urgency text NOT NULL,
  enter_ok boolean NOT NULL,
  room text NOT NULL,
  description text NOT NULL,
  follow_up text,
  follow_up_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS guest_report_person_idx ON guest_report (person_id, created_at DESC);
CREATE INDEX IF NOT EXISTS guest_report_ticket_idx ON guest_report (ticket_id);
