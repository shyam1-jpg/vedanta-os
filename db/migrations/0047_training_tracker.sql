-- Induction and training tracker. Separate from the older one-line training_record.
-- A person is cleared for unsupervised work only when every required item is signed off.

CREATE TABLE IF NOT EXISTS training_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  title text NOT NULL,
  description text,
  category text NOT NULL CHECK (category IN ('fire_safety','food_hygiene','allergen','gdpr','health_safety','manual_handling','coshh','role_specific','other')),
  required_before_unsupervised boolean NOT NULL DEFAULT false,
  certificate boolean NOT NULL DEFAULT false,
  valid_months integer,
  sop_id uuid REFERENCES staff_sop(id),
  link text,
  attachment text,
  example boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS training_item_property_idx ON training_item (property_id, title);

CREATE TABLE IF NOT EXISTS training_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  name text NOT NULL,
  role_code text,
  department text,
  example boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS training_template_item (
  template_id uuid NOT NULL REFERENCES training_template(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES training_item(id) ON DELETE CASCADE,
  PRIMARY KEY (template_id, item_id)
);

CREATE TABLE IF NOT EXISTS training_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  item_id uuid NOT NULL REFERENCES training_item(id),
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','completed')),
  done_at timestamptz,
  signed_off_at timestamptz,
  signed_off_by uuid REFERENCES app_user(id),
  signed_off_name text,
  notes text,
  certificate text,
  issued_on date,
  expires_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, user_id, item_id)
);
CREATE INDEX IF NOT EXISTS training_assignment_user_idx ON training_assignment (user_id);
CREATE INDEX IF NOT EXISTS training_assignment_expiry_idx ON training_assignment (property_id, expires_on) WHERE expires_on IS NOT NULL;

CREATE TABLE IF NOT EXISTS training_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES training_assignment(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  from_status text,
  to_status text,
  note text,
  by_user_id uuid REFERENCES app_user(id),
  by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS training_alert (
  assignment_id uuid NOT NULL REFERENCES training_assignment(id) ON DELETE CASCADE,
  kind text NOT NULL,
  expires_on date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, kind, expires_on)
);

INSERT INTO permission (code, description) VALUES
  ('training.self', 'See and update your own training'),
  ('training.signoff', 'Sign off someone else''s training'),
  ('training.manage', 'Edit the training library, inductions, and sign-off')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'training.self' FROM role r
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, p.code FROM role r
CROSS JOIN (VALUES ('training.signoff'), ('training.manage')) AS p(code)
WHERE r.code IN (
  'SYSTEM_OWNER','GENERAL_MANAGER','OPERATIONS_MANAGER','ROTA_MANAGER',
  'FRONT_OFFICE_MANAGER','RETREAT_MANAGER','HK_SUPERVISOR','RESTAURANT_MANAGER',
  'HEAD_CHEF','KITCHEN_MANAGER','ESTATE_MANAGER','FINANCE_HR'
)
ON CONFLICT DO NOTHING;
