-- Guest gratitude notes.
-- A guest may leave a message, an optional name, a placeholder amount, or a small gesture.
-- payment_status is constrained to a pledge: this table does not record a captured payment.
-- recipient_code is a placeholder catalogue id, not an app_user. Nothing here is allocated
-- to staff. distribution_status stays undecided until a manager decides later.

CREATE TABLE IF NOT EXISTS guest_gratitude (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  recipient_kind text NOT NULL CHECK (recipient_kind IN ('team', 'department', 'person')),
  recipient_code text NOT NULL,
  recipient_label text NOT NULL,
  message text,
  guest_name text,
  gesture text,
  amount numeric(12,2),
  currency char(3) NOT NULL DEFAULT 'GBP',
  payment_status text NOT NULL DEFAULT 'pledged_not_paid' CHECK (payment_status = 'pledged_not_paid'),
  payment_provider text NOT NULL DEFAULT 'placeholder',
  distribution_status text NOT NULL DEFAULT 'undecided',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS guest_gratitude_property_created
  ON guest_gratitude (property_id, created_at DESC);
