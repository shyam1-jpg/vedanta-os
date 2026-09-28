-- Shift swap requests, the open board, and per-person rota constraints.
-- House-specific names and caps stay out of git. They live in staff_rota_rule
-- or in the gitignored config/rota-constraints.json file.

CREATE TABLE IF NOT EXISTS staff_rota_rule (
  user_id uuid PRIMARY KEY REFERENCES app_user(id),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  earliest_start time,
  weekly_hours_cap numeric(6,2),
  monthly_hours_cap numeric(6,2),
  unavailable_dates date[] NOT NULL DEFAULT '{}',
  skills text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shift_swap (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  kind text NOT NULL CHECK (kind IN ('swap', 'cover', 'day_off')),
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'approved', 'rejected', 'cancelled', 'expired')),
  requester_id uuid NOT NULL REFERENCES app_user(id),
  shift_id uuid NOT NULL REFERENCES rota_shift(id),
  partner_id uuid REFERENCES app_user(id),
  partner_shift_id uuid REFERENCES rota_shift(id),
  claimer_id uuid REFERENCES app_user(id),
  reason text NOT NULL DEFAULT '',
  open boolean NOT NULL DEFAULT false,
  manager_note text,
  decided_by uuid REFERENCES app_user(id),
  decided_at timestamptz,
  source text NOT NULL DEFAULT 'staff' CHECK (source IN ('staff', 'manager')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shift_swap_property_status_idx ON shift_swap (property_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS shift_swap_shift_idx ON shift_swap (shift_id);
CREATE UNIQUE INDEX IF NOT EXISTS shift_swap_one_live_shift ON shift_swap (shift_id) WHERE status IN ('pending', 'accepted');

CREATE TABLE IF NOT EXISTS shift_swap_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  swap_id uuid NOT NULL REFERENCES shift_swap(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  action text NOT NULL,
  note text NOT NULL DEFAULT '',
  by_user_id uuid REFERENCES app_user(id),
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shift_swap_event_swap_idx ON shift_swap_event (swap_id, created_at);

CREATE TABLE IF NOT EXISTS shift_swap_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  swap_id uuid NOT NULL REFERENCES shift_swap(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES rota_shift(id),
  from_user_id uuid NOT NULL REFERENCES app_user(id),
  to_user_id uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO permission (code, description) VALUES
  ('shift.swap', 'Request, accept, or claim a shift swap'),
  ('shift.swap.manage', 'Approve shift swaps and edit rota constraints')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'shift.swap' FROM role r
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'shift.swap.manage' FROM role r
WHERE r.code IN (
  'SYSTEM_OWNER', 'GENERAL_MANAGER', 'OPERATIONS_MANAGER', 'ROTA_MANAGER',
  'FRONT_OFFICE_MANAGER', 'RETREAT_MANAGER', 'RESTAURANT_MANAGER'
)
ON CONFLICT DO NOTHING;
