-- Reliable guest booking: one save per attempt, a record when a save fails,
-- and a deposit status the folio and the guest can both see.

ALTER TABLE guest_enquiry
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS deposit_status text NOT NULL DEFAULT 'unpaid';

ALTER TABLE guest_enquiry DROP CONSTRAINT IF EXISTS guest_enquiry_deposit_status_check;
ALTER TABLE guest_enquiry
  ADD CONSTRAINT guest_enquiry_deposit_status_check
  CHECK (deposit_status IN ('unpaid', 'paid', 'failed', 'refunded'));

CREATE UNIQUE INDEX IF NOT EXISTS guest_enquiry_idempotency
  ON guest_enquiry (property_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE booking_group
  ADD COLUMN IF NOT EXISTS deposit_status text NOT NULL DEFAULT 'unpaid';

ALTER TABLE booking_group DROP CONSTRAINT IF EXISTS booking_group_deposit_status_check;
ALTER TABLE booking_group
  ADD CONSTRAINT booking_group_deposit_status_check
  CHECK (deposit_status IN ('unpaid', 'paid', 'failed', 'refunded'));

CREATE TABLE IF NOT EXISTS guest_failed_submission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  reference text NOT NULL UNIQUE,
  idempotency_key text,
  email text,
  name text,
  arrival_date date,
  departure_date date,
  error_code text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS guest_failed_submission_key
  ON guest_failed_submission (property_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payment_stripe_intent_uidx
  ON payment (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
