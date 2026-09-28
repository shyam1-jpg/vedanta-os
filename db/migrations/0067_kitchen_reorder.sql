-- Kitchen reorder drafts. This is not the finance purchase order.
-- A manager approves before a supplier is emailed, unless that supplier's auto-send is on.
-- par_level 0 means "do not order yet", so existing rows stay quiet when the flag is switched on.

ALTER TABLE kitchen_stock_item
  ADD COLUMN IF NOT EXISTS par_level numeric(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reorder_at numeric(12,3),
  ADD COLUMN IF NOT EXISTS pack_size numeric(12,3) NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS kitchen_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  supplier_id uuid REFERENCES supplier(id),
  supplier_key text NOT NULL DEFAULT '',
  supplier_name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','sent','delivered','cancelled')),
  auto_sent boolean NOT NULL DEFAULT false,
  approved_by uuid REFERENCES app_user(id),
  approved_name text,
  approved_at timestamptz,
  sent_at timestamptz,
  sent_to text,
  supplier_response text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS kitchen_order_one_open
  ON kitchen_order (property_id, supplier_key)
  WHERE status IN ('draft', 'approved', 'sent');

CREATE INDEX IF NOT EXISTS kitchen_order_property_idx ON kitchen_order (property_id, created_at DESC);

CREATE TABLE IF NOT EXISTS kitchen_order_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES kitchen_order(id) ON DELETE CASCADE,
  item_id uuid REFERENCES kitchen_stock_item(id),
  name text NOT NULL,
  unit text NOT NULL,
  packs numeric(12,3) NOT NULL,
  pack_size numeric(12,3) NOT NULL,
  quantity numeric(12,3) NOT NULL
);

UPDATE kitchen_stock_item
SET par_level = CASE name
      WHEN 'Basmati rice' THEN 20
      WHEN 'Chickpeas' THEN 8
      WHEN 'Ghee' THEN 3
      WHEN 'Oat milk' THEN 12
      WHEN 'Paper towels' THEN 6
      WHEN 'Dishwasher detergent' THEN 2
      ELSE par_level
    END,
    pack_size = 1,
    reorder_at = low_threshold
WHERE example
  AND name IN ('Basmati rice', 'Chickpeas', 'Ghee', 'Oat milk', 'Paper towels', 'Dishwasher detergent')
  AND par_level = 0;
