-- Lost and found. Guest contact is personal data and is cleared when the case closes.

CREATE TABLE IF NOT EXISTS lost_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  description text NOT NULL,
  category text NOT NULL CHECK (category IN ('clothing','electronics','jewellery','documents','keys','bags','other')),
  place text NOT NULL,
  found_on date NOT NULL,
  found_by_user_id uuid REFERENCES app_user(id),
  found_by_name text,
  photo text,
  storage text,
  status text NOT NULL DEFAULT 'logged' CHECK (status IN ('logged','matched','claimed','returned','disposed','donated')),
  claimant_name text,
  claimed_at timestamptz,
  return_method text CHECK (return_method IS NULL OR return_method IN ('posted','collected')),
  handled_by_user_id uuid REFERENCES app_user(id),
  handled_by_name text,
  closed_at timestamptz,
  retention_alerted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lost_item_property_idx ON lost_item (property_id, found_on DESC);

CREATE TABLE IF NOT EXISTS lost_report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  description text NOT NULL,
  category text NOT NULL CHECK (category IN ('clothing','electronics','jewellery','documents','keys','bags','other')),
  place text,
  happened_on date,
  guest_account_id uuid REFERENCES guest_account(id),
  group_id uuid REFERENCES booking_group(id),
  contact_name text,
  contact_email text,
  contact_phone text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','matched','closed')),
  matched_item_id uuid REFERENCES lost_item(id),
  created_by_user_id uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lost_report_property_idx ON lost_report (property_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lost_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid REFERENCES lost_item(id) ON DELETE CASCADE,
  report_id uuid REFERENCES lost_report(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  from_status text,
  to_status text,
  note text,
  by_user_id uuid REFERENCES app_user(id),
  by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lost_event_item_idx ON lost_event (item_id, created_at);

INSERT INTO permission (code, description) VALUES
  ('lostfound.log', 'Record and update lost and found items')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'lostfound.log' FROM role r
ON CONFLICT DO NOTHING;
