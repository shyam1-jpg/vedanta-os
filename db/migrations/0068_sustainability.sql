-- Sustainability readings for the kitchen and the goshala.
-- The tracker and the public summary stay off until settings say otherwise.
-- Example numbers only. The cows are never milked.

CREATE TABLE IF NOT EXISTS sustainability_reading (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  metric text NOT NULL,
  period date NOT NULL,
  value numeric(12,3) NOT NULL,
  note text,
  by_user_id uuid REFERENCES app_user(id),
  by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sustainability_reading_idx ON sustainability_reading (property_id, metric, period);

CREATE TABLE IF NOT EXISTS sustainability_baseline (
  property_id uuid NOT NULL REFERENCES property(id),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  metric text NOT NULL,
  value numeric(12,3) NOT NULL,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, metric)
);

INSERT INTO permission (code, description) VALUES
  ('sustainability.log', 'Enter sustainability readings and export the house report')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'sustainability.log' FROM role r
WHERE r.code IN (
  'SYSTEM_OWNER','GENERAL_MANAGER','OPERATIONS_MANAGER','HEAD_CHEF','KITCHEN_MANAGER'
)
ON CONFLICT DO NOTHING;

INSERT INTO sustainability_reading (tenant_id, property_id, metric, period, value, note, by_name)
SELECT p.tenant_id, p.id, x.metric, x.period::date, x.value, 'Example reading', 'Example staff'
FROM property p
CROSS JOIN (
  VALUES
    ('waste_plate', '2026-09-01', 4.2),
    ('waste_prep', '2026-09-01', 6.1),
    ('waste_diverted', '2026-09-01', 9.0),
    ('energy_kwh', '2026-09-01', 1200),
    ('water_m3', '2026-09-01', 40),
    ('sourcing_local', '2026-09-01', 60),
    ('sourcing_organic', '2026-09-01', 40),
    ('seva_hours', '2026-09-01', 18),
    ('goshala_feed', '2026-09-01', 120),
    ('goshala_bedding', '2026-09-01', 30),
    ('goshala_care', '2026-09-01', 4)
) AS x(metric, period, value)
WHERE NOT EXISTS (
  SELECT 1 FROM sustainability_reading r
  WHERE r.property_id = p.id AND r.metric = x.metric AND r.period = x.period::date
);

INSERT INTO sustainability_baseline (property_id, tenant_id, metric, value, note)
SELECT p.id, p.tenant_id, x.metric, x.value, 'Example baseline'
FROM property p
CROSS JOIN (
  VALUES
    ('waste_plate', 4),
    ('waste_prep', 6),
    ('waste_diverted', 8),
    ('energy_kwh', 1100),
    ('water_m3', 38),
    ('seva_hours', 16),
    ('goshala_feed', 100)
) AS x(metric, value)
ON CONFLICT DO NOTHING;
