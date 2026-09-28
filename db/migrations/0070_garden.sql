-- Vegetable garden notes. The log stays off until settings say otherwise.
-- A harvest is incoming kitchen stock, source garden.
-- Catering waste is never fed to the cows. Only produce that stays on the plot may be.

ALTER TABLE kitchen_stock_item
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'purchased';

ALTER TABLE kitchen_stock_log
  ADD COLUMN IF NOT EXISTS source text;

CREATE TABLE IF NOT EXISTS garden_plot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  name text NOT NULL,
  crop text NOT NULL,
  variety text NOT NULL DEFAULT '',
  planted_on date NOT NULL,
  due_on date NOT NULL,
  status text NOT NULL DEFAULT 'growing' CHECK (status IN ('growing', 'cleared')),
  example boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, name)
);

CREATE TABLE IF NOT EXISTS garden_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  plot_id uuid REFERENCES garden_plot(id),
  kind text NOT NULL CHECK (kind IN ('harvest', 'use', 'waste')),
  crop text NOT NULL,
  variety text NOT NULL DEFAULT '',
  kg numeric(12,3) NOT NULL CHECK (kg > 0),
  waste_type text CHECK (waste_type IS NULL OR waste_type IN ('prep', 'plate', 'spoiled', 'surplus')),
  destination text CHECK (destination IS NULL OR destination IN ('compost', 'digestion', 'landfill', 'donated', 'cows')),
  origin text NOT NULL DEFAULT 'kitchen' CHECK (origin IN ('kitchen', 'plot')),
  on_date date NOT NULL,
  stock_item_id uuid REFERENCES kitchen_stock_item(id),
  by_user_id uuid REFERENCES app_user(id),
  by_name text,
  example boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (destination IS DISTINCT FROM 'cows' OR (origin = 'plot' AND waste_type IS NULL))
);

CREATE INDEX IF NOT EXISTS garden_entry_property_idx ON garden_entry (property_id, on_date DESC);

INSERT INTO permission (code, description) VALUES
  ('garden.log', 'Log plantings, harvests, and garden or kitchen waste')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'garden.log' FROM role r
WHERE r.code IN (
  'SYSTEM_OWNER', 'GENERAL_MANAGER', 'OPERATIONS_MANAGER', 'HEAD_CHEF', 'KITCHEN_MANAGER', 'KITCHEN',
  'ESTATE_MANAGER', 'GROUNDS_MANAGER', 'GROUNDS', 'GROUNDS_ASSISTANT'
)
ON CONFLICT DO NOTHING;

INSERT INTO garden_plot (tenant_id, property_id, name, crop, variety, planted_on, due_on, example)
SELECT p.tenant_id, p.id, x.name, x.crop, x.variety, x.planted_on::date, x.due_on::date, true
FROM property p
CROSS JOIN (
  VALUES
    ('Example bed', 'Example kale', 'Example variety', '2026-04-12', '2026-09-20'),
    ('Example bed 2', 'Example chard', 'Example variety', '2026-07-01', '2026-10-15')
) AS x(name, crop, variety, planted_on, due_on)
WHERE NOT EXISTS (
  SELECT 1 FROM garden_plot g WHERE g.property_id = p.id AND g.name = x.name
);

INSERT INTO kitchen_stock_item (tenant_id, property_id, name, unit, quantity, low_threshold, notes, example, source)
SELECT p.tenant_id, p.id, 'Example kale (Example variety)', 'kg', 2.5, 0, 'From the garden', true, 'garden'
FROM property p
WHERE NOT EXISTS (
  SELECT 1 FROM kitchen_stock_item i WHERE i.property_id = p.id AND i.name = 'Example kale (Example variety)'
);

INSERT INTO garden_entry (tenant_id, property_id, plot_id, kind, crop, variety, kg, origin, on_date, stock_item_id, by_name, example)
SELECT p.tenant_id, p.id, g.id, 'harvest', 'Example kale', 'Example variety', 2.5, 'plot', DATE '2026-09-27', i.id, 'Example staff', true
FROM property p
JOIN garden_plot g ON g.property_id = p.id AND g.name = 'Example bed'
JOIN kitchen_stock_item i ON i.property_id = p.id AND i.name = 'Example kale (Example variety)'
WHERE NOT EXISTS (
  SELECT 1 FROM garden_entry e WHERE e.property_id = p.id AND e.kind = 'harvest' AND e.crop = 'Example kale' AND e.on_date = DATE '2026-09-27'
);

INSERT INTO kitchen_stock_log (item_id, tenant_id, property_id, action, quantity_before, quantity_after, delta, note, by_name, source)
SELECT i.id, i.tenant_id, i.property_id, 'restock', 0, 2.5, 2.5, 'From the garden', 'Example staff', 'garden'
FROM kitchen_stock_item i
WHERE i.name = 'Example kale (Example variety)' AND i.example
  AND NOT EXISTS (
    SELECT 1 FROM kitchen_stock_log l WHERE l.item_id = i.id AND l.note = 'From the garden' AND l.source = 'garden'
  );

INSERT INTO garden_entry (tenant_id, property_id, kind, crop, variety, kg, waste_type, destination, origin, on_date, by_name, example)
SELECT p.tenant_id, p.id, 'waste', 'Example kale', 'Example variety', 0.3, 'prep', 'compost', 'kitchen', DATE '2026-09-28', 'Example staff', true
FROM property p
WHERE NOT EXISTS (
  SELECT 1 FROM garden_entry e WHERE e.property_id = p.id AND e.waste_type = 'prep' AND e.on_date = DATE '2026-09-28'
);

INSERT INTO garden_entry (tenant_id, property_id, plot_id, kind, crop, variety, kg, destination, origin, on_date, by_name, example)
SELECT p.tenant_id, p.id, g.id, 'waste', 'Example chard', 'Example variety', 0.4, 'cows', 'plot', DATE '2026-09-28', 'Example staff', true
FROM property p
JOIN garden_plot g ON g.property_id = p.id AND g.name = 'Example bed 2'
WHERE NOT EXISTS (
  SELECT 1 FROM garden_entry e WHERE e.property_id = p.id AND e.destination = 'cows' AND e.on_date = DATE '2026-09-28'
);
