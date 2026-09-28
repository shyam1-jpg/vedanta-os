-- One night-audit snapshot per property per London date.
-- The scheduled job inserts once. An on-demand tap refreshes that same row.

CREATE TABLE IF NOT EXISTS night_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  audit_date date NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by uuid REFERENCES app_user(id),
  source text NOT NULL CHECK (source IN ('schedule', 'demand')),
  data jsonb NOT NULL,
  html text NOT NULL,
  emailed_at timestamptz,
  UNIQUE (property_id, audit_date)
);

CREATE INDEX IF NOT EXISTS night_audit_property_date_idx ON night_audit (property_id, audit_date DESC);

INSERT INTO permission (code, description) VALUES
  ('night.audit', 'Read and run the night audit')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'night.audit' FROM role r
WHERE r.code IN (
  'SYSTEM_OWNER', 'GENERAL_MANAGER', 'OPERATIONS_MANAGER',
  'FRONT_OFFICE_MANAGER', 'RETREAT_MANAGER', 'RESTAURANT_MANAGER'
)
ON CONFLICT DO NOTHING;
