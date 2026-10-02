-- Links a purchase to a retreat only when a later save sets booking_id.
-- No purchase is placed here, and no retreat is marked ready.

ALTER TABLE purchase_requisition
  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES booking_group(id);

ALTER TABLE purchase_order
  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES booking_group(id);

CREATE INDEX IF NOT EXISTS requisition_booking ON purchase_requisition (booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS purchase_order_booking ON purchase_order (booking_id) WHERE booking_id IS NOT NULL;

-- Staff-saved safety for one retreat. Blank rows are not inserted.
-- A template with no body is not a sign-off.
CREATE TABLE IF NOT EXISTS retreat_safety_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  booking_id uuid NOT NULL REFERENCES booking_group(id),
  kind text NOT NULL CHECK (kind IN ('incident_note', 'pre_arrival', 'risk_assessment', 'first_aid', 'contact')),
  body text NOT NULL CHECK (length(btrim(body)) > 0),
  signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS retreat_safety_booking ON retreat_safety_record (property_id, booking_id, kind);
