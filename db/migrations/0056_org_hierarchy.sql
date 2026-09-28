-- Staff hierarchy. Departments stay on department. Sub-sections use department_section,
-- the same columns as the rota and SOP branch (cursor/house-rota-sop-teams-d8d3), so a merge adds them once.
-- Reporting lines, vacant seats, and the audit of structure changes live here.

ALTER TABLE department ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 100;
ALTER TABLE department ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES department(id);

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

CREATE TABLE IF NOT EXISTS org_position (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  property_id     uuid NOT NULL REFERENCES property(id),
  department_id   uuid NOT NULL REFERENCES department(id),
  section_id      uuid REFERENCES department_section(id),
  role_id         uuid REFERENCES role(id),
  code            text NOT NULL,
  title           text NOT NULL,
  level           text NOT NULL CHECK (level IN ('gm', 'head', 'lead', 'staff')),
  sort_order      int NOT NULL DEFAULT 100,
  reports_to      uuid REFERENCES org_position(id),
  holder_id       uuid REFERENCES app_user(id),
  work_phone      text,
  personal_phone  text,
  example         boolean NOT NULL DEFAULT false,
  active          boolean NOT NULL DEFAULT true,
  effective_from  date NOT NULL DEFAULT current_date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, code)
);
CREATE INDEX IF NOT EXISTS org_position_property ON org_position (property_id, department_id);

CREATE TABLE IF NOT EXISTS org_dotted (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     uuid NOT NULL REFERENCES property(id),
  from_id         uuid NOT NULL REFERENCES org_position(id) ON DELETE CASCADE,
  to_id           uuid NOT NULL REFERENCES org_position(id) ON DELETE CASCADE,
  effective_from  date NOT NULL DEFAULT current_date,
  UNIQUE (from_id, to_id)
);

CREATE TABLE IF NOT EXISTS org_change (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  property_id   uuid NOT NULL REFERENCES property(id),
  position_id   uuid NOT NULL REFERENCES org_position(id),
  actor_id      uuid REFERENCES app_user(id),
  effective_on  date NOT NULL,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  kind          text NOT NULL CHECK (kind IN ('reassign', 'create', 'undo')),
  summary       text NOT NULL,
  before        jsonb NOT NULL DEFAULT '{}',
  after         jsonb NOT NULL DEFAULT '{}',
  undone_at     timestamptz,
  undone_by     uuid REFERENCES app_user(id)
);
CREATE INDEX IF NOT EXISTS org_change_property ON org_change (property_id, occurred_at DESC);

INSERT INTO permission (code, description) VALUES
  ('org.read', 'See the organisation tree'),
  ('org.manage', 'Move people on the organisation tree')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'org.read' FROM role r
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'org.manage' FROM role r
WHERE r.code IN ('SYSTEM_OWNER', 'GENERAL_MANAGER')
ON CONFLICT DO NOTHING;
