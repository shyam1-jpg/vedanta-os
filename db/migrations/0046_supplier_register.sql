-- Supplier register fields and a delivery log. The purchasing supplier row is the same record.
-- Stock items can point at a preferred supplier.

ALTER TABLE supplier
  ADD COLUMN IF NOT EXISTS categories text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS account_number text,
  ADD COLUMN IF NOT EXISTS delivery_days text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS every_n integer,
  ADD COLUMN IF NOT EXISTS every_unit text,
  ADD COLUMN IF NOT EXISTS next_delivery date,
  ADD COLUMN IF NOT EXISTS lead_time_days integer,
  ADD COLUMN IF NOT EXISTS example boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS supplier_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES supplier(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  status text NOT NULL CHECK (status IN ('received','partial','missed')),
  note text,
  photo text,
  due_on date,
  by_user_id uuid REFERENCES app_user(id),
  by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_delivery_idx ON supplier_delivery (supplier_id, created_at DESC);

CREATE TABLE IF NOT EXISTS supplier_alert (
  supplier_id uuid NOT NULL REFERENCES supplier(id) ON DELETE CASCADE,
  kind text NOT NULL,
  due_on date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (supplier_id, kind, due_on)
);

ALTER TABLE kitchen_stock_item
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES supplier(id);

INSERT INTO permission (code, description) VALUES
  ('supplier.register', 'See and update the supplier register')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'supplier.register' FROM role r
WHERE r.code IN (
  'SYSTEM_OWNER','GENERAL_MANAGER','OPERATIONS_MANAGER',
  'HEAD_CHEF','KITCHEN','KITCHEN_MANAGER','SOUS_CHEF','SENIOR_CHEF_DE_PARTIE','CHEF_DE_PARTIE',
  'KITCHEN_APPRENTICE','KITCHEN_ASSISTANT','KITCHEN_PORTER','PURCHASING','FINANCE_HR'
)
ON CONFLICT DO NOTHING;
