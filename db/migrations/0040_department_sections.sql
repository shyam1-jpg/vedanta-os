-- A department can contain sub-sections. Gyms belongs to Restaurant, not beside it.
-- The section name is data, so the house can rename it without a code change.

ALTER TABLE department ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 100;

CREATE TABLE IF NOT EXISTS department_section (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  property_id   uuid NOT NULL REFERENCES property(id),
  department_id uuid NOT NULL REFERENCES department(id) ON DELETE CASCADE,
  code          text NOT NULL,
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department_id, code)
);
CREATE INDEX IF NOT EXISTS department_section_property ON department_section (property_id, department_id);

ALTER TABLE membership ADD COLUMN IF NOT EXISTS section_id uuid REFERENCES department_section(id);
