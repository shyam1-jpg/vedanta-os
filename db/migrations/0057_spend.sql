-- Monthly department budgets and the expenses logged against them.
-- Amounts are integer pence in GBP. Departments stay on the shared department table.

CREATE TABLE IF NOT EXISTS spend_budget (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  department_id uuid NOT NULL REFERENCES department(id),
  month date NOT NULL,
  amount_pence int NOT NULL CHECK (amount_pence >= 0),
  set_by uuid REFERENCES app_user(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, department_id, month)
);

CREATE TABLE IF NOT EXISTS spend_alert (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  department_id uuid NOT NULL REFERENCES department(id),
  month date NOT NULL,
  threshold text NOT NULL CHECK (threshold IN ('80', '100')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, department_id, month, threshold)
);

CREATE TABLE IF NOT EXISTS spend_expense (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  department_id uuid NOT NULL REFERENCES department(id),
  amount_pence int NOT NULL CHECK (amount_pence > 0),
  category text NOT NULL,
  spent_on date NOT NULL,
  spent_by uuid NOT NULL REFERENCES app_user(id),
  logged_by uuid NOT NULL REFERENCES app_user(id),
  supplier_id uuid REFERENCES supplier(id),
  description text NOT NULL,
  receipt text,
  ticket_id uuid REFERENCES maintenance_ticket(id),
  stock_log_id uuid REFERENCES kitchen_stock_log(id),
  review text NOT NULL DEFAULT 'open' CHECK (review IN ('open', 'checked', 'queried')),
  review_note text,
  reviewed_by uuid REFERENCES app_user(id),
  reviewed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS spend_expense_month_idx ON spend_expense (property_id, department_id, spent_on) WHERE deleted_at IS NULL;

INSERT INTO permission (code, description) VALUES
  ('spend.log', 'Log and see department spend'),
  ('spend.manage', 'Set department budgets and see every department')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'spend.log' FROM role r
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'spend.manage' FROM role r
WHERE r.code IN ('SYSTEM_OWNER', 'GENERAL_MANAGER')
ON CONFLICT DO NOTHING;
