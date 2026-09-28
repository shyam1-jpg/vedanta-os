-- Structured guest-booking party, carry-over fields, and per-allergen severity.
-- Department inboxes stay in property.settings (no addresses in git).

ALTER TABLE guest_enquiry
  ADD COLUMN IF NOT EXISTS party text,
  ADD COLUMN IF NOT EXISTS arrival_slot text,
  ADD COLUMN IF NOT EXISTS departure_slot text;

ALTER TABLE guest_enquiry DROP CONSTRAINT IF EXISTS guest_enquiry_status_check;
ALTER TABLE guest_enquiry ADD CONSTRAINT guest_enquiry_status_check
  CHECK (status IN ('ENQUIRY','ACKNOWLEDGED','CONVERTED','DECLINED','CANCELLED'));

ALTER TABLE booking_group
  ADD COLUMN IF NOT EXISTS accessibility_notes text,
  ADD COLUMN IF NOT EXISTS room_preference text,
  ADD COLUMN IF NOT EXISTS arrival_time_note text,
  ADD COLUMN IF NOT EXISTS travel_notes text;

ALTER TABLE diet_profile
  ADD COLUMN IF NOT EXISTS allergen_detail text;

CREATE INDEX IF NOT EXISTS ops_task_guest_booking_idx
  ON ops_task (property_id, source, event_label);
