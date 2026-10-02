-- Staff-entered back-office figures. No sample money, shops, or retreats.

CREATE TABLE IF NOT EXISTS supplier_bill (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  spent_on date NOT NULL,
  supplier_code text NOT NULL,
  supplier_name text NOT NULL,
  local_shop boolean NOT NULL DEFAULT false,
  kind text NOT NULL CHECK (kind IN ('food', 'other')),
  department text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  note text,
  delivered_at timestamptz,
  quality smallint CHECK (quality BETWEEN 1 AND 5),
  price_score smallint CHECK (price_score BETWEEN 1 AND 5),
  reliability smallint CHECK (reliability BETWEEN 1 AND 5),
  entered_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (delivered_at IS NOT NULL OR (quality IS NULL AND price_score IS NULL AND reliability IS NULL))
);
CREATE INDEX IF NOT EXISTS supplier_bill_property ON supplier_bill (property_id, spent_on DESC);

CREATE TABLE IF NOT EXISTS retreat_income (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  received_on date NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  note text,
  booking_id uuid REFERENCES booking_group(id),
  entered_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS retreat_income_property ON retreat_income (property_id, received_on DESC);

CREATE TABLE IF NOT EXISTS petty_cash (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  on_date date NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  signed_out_by uuid NOT NULL REFERENCES app_user(id),
  note text,
  entered_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS petty_cash_property ON petty_cash (property_id, on_date DESC);

CREATE TABLE IF NOT EXISTS staffing_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  guest_count int NOT NULL CHECK (guest_count >= 0),
  department text NOT NULL,
  required int NOT NULL CHECK (required >= 0),
  saved_by uuid REFERENCES app_user(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, guest_count, department)
);
