-- Migration 0027: guest 360 profile
-- Persistent preferences and history per guest so staff see the full picture
-- and the house remembers returning guests automatically.

-- Preferences stored against the guest account (survives across enquiries)
ALTER TABLE guest_account
  ADD COLUMN IF NOT EXISTS dietary_notes        text,
  ADD COLUMN IF NOT EXISTS accessibility_notes  text,
  ADD COLUMN IF NOT EXISTS room_preference      text,   -- e.g. "ground floor", "quiet", "twin"
  ADD COLUMN IF NOT EXISTS arrival_preference   text,   -- e.g. "afternoon", "after 16:00"
  ADD COLUMN IF NOT EXISTS travel_notes         text,
  ADD COLUMN IF NOT EXISTS marketing_ok         boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS notes                text,   -- private house notes about this guest
  ADD COLUMN IF NOT EXISTS vip                  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flagged              boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flagged_reason       text;

-- Guest communications log — every email/message sent to this guest
CREATE TABLE IF NOT EXISTS guest_communication (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  property_id     uuid NOT NULL REFERENCES property(id),
  guest_id        uuid NOT NULL REFERENCES guest_account(id) ON DELETE CASCADE,
  enquiry_id      uuid REFERENCES guest_enquiry(id),
  kind            text NOT NULL,    -- 'email' | 'sms' | 'whatsapp' | 'letter' | 'phone' | 'in_person'
  direction       text NOT NULL DEFAULT 'outbound',  -- 'outbound' | 'inbound'
  subject         text,
  body            text,
  sent_by_user_id uuid REFERENCES app_user(id),
  status          text NOT NULL DEFAULT 'sent',  -- 'sent' | 'delivered' | 'failed' | 'read'
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS guest_comm_guest ON guest_communication (guest_id, created_at DESC);

-- Complaint & service recovery
CREATE TABLE IF NOT EXISTS guest_complaint (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  property_id     uuid NOT NULL REFERENCES property(id),
  guest_id        uuid REFERENCES guest_account(id),
  enquiry_id      uuid REFERENCES guest_enquiry(id),
  severity        text NOT NULL DEFAULT 'minor',   -- 'minor' | 'moderate' | 'serious' | 'critical'
  department      text,
  description     text NOT NULL,
  compensation    text,
  resolution      text,
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES app_user(id),
  guest_satisfied boolean,
  created_by      uuid REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS guest_complaint_guest ON guest_complaint (guest_id, created_at DESC);
CREATE INDEX IF NOT EXISTS guest_complaint_property ON guest_complaint (property_id, created_at DESC);
