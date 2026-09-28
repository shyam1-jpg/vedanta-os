-- Tags and read receipts on the existing shift note, plus a short kitchen stock list.

ALTER TABLE ops_handover
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS ops_handover_ack (
  handover_id uuid NOT NULL REFERENCES ops_handover(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (handover_id, user_id)
);

CREATE TABLE IF NOT EXISTS kitchen_stock_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  name text NOT NULL,
  unit text NOT NULL,
  quantity numeric(12,3) NOT NULL DEFAULT 0,
  low_threshold numeric(12,3) NOT NULL DEFAULT 0,
  supplier text,
  notes text,
  example boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  low_alerted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, name)
);

CREATE TABLE IF NOT EXISTS kitchen_stock_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES kitchen_stock_item(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  action text NOT NULL CHECK (action IN ('use','restock','set','edit')),
  quantity_before numeric(12,3),
  quantity_after numeric(12,3),
  delta numeric(12,3),
  note text,
  by_user_id uuid REFERENCES app_user(id),
  by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kitchen_stock_log_item_idx ON kitchen_stock_log (item_id, created_at DESC);

INSERT INTO permission (code, description) VALUES
  ('kitchen.stock', 'See the kitchen stock list and log usage or a delivery')
ON CONFLICT DO NOTHING;
