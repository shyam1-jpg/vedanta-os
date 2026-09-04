-- Migration 0035: Stripe payment intents
-- Links Stripe payment intents to folios so we can track online payments end-to-end.

ALTER TABLE payment
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS stripe_charge_id          text,
  ADD COLUMN IF NOT EXISTS stripe_status             text;  -- 'requires_payment_method'|'processing'|'succeeded'|'canceled'

CREATE INDEX IF NOT EXISTS payment_stripe ON payment (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

-- Guest enquiry deposit tracking
ALTER TABLE guest_enquiry
  ADD COLUMN IF NOT EXISTS deposit_amount        numeric(10,2),
  ADD COLUMN IF NOT EXISTS deposit_paid_at       timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_customer_id    text,
  ADD COLUMN IF NOT EXISTS stripe_session_id     text;

-- Stripe webhook events log (idempotency)
CREATE TABLE IF NOT EXISTS stripe_event (
  id              text PRIMARY KEY,   -- Stripe event ID (evt_xxx)
  tenant_id       uuid REFERENCES tenant(id),
  kind            text NOT NULL,
  payload         jsonb,
  processed_at    timestamptz NOT NULL DEFAULT now()
);
