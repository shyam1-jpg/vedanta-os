-- Compliance calendar. Separate from the older one-off compliance_record log.
-- A repeating item keeps every completion and moves its next due date forward.
-- A problem found on completion opens a corrective action on the existing capa table.

ALTER TABLE capa ALTER COLUMN feedback_id DROP NOT NULL;
ALTER TABLE capa ADD COLUMN IF NOT EXISTS source_type text;
ALTER TABLE capa ADD COLUMN IF NOT EXISTS source_id uuid;

CREATE TABLE IF NOT EXISTS compliance_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  title text NOT NULL,
  category text NOT NULL CHECK (category IN ('fire_safety','food_safety','gdpr','insurance','equipment','health_safety','licensing','other')),
  repeating boolean NOT NULL DEFAULT false,
  every_n integer,
  every_unit text CHECK (every_unit IS NULL OR every_unit IN ('day','week','month','year')),
  next_due date,
  responsible_user_id uuid REFERENCES app_user(id),
  example boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS compliance_item_due_idx ON compliance_item (property_id, next_due) WHERE active;

CREATE TABLE IF NOT EXISTS compliance_completion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES compliance_item(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  due_on date,
  notes text,
  attachment text,
  found_issues boolean NOT NULL DEFAULT false,
  capa_id uuid REFERENCES capa(id),
  by_user_id uuid REFERENCES app_user(id),
  by_name text,
  completed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS compliance_completion_item_idx ON compliance_completion (item_id, completed_at DESC);

CREATE TABLE IF NOT EXISTS compliance_alert (
  item_id uuid NOT NULL REFERENCES compliance_item(id) ON DELETE CASCADE,
  kind text NOT NULL,
  due_on date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, kind, due_on)
);
