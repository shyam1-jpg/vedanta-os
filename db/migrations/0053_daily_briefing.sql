-- Daily briefing. A VIP flag on the guest profile, a per-user home screen,
-- and pin or dismiss marks that last for one London day.

ALTER TABLE guest_profile
  ADD COLUMN IF NOT EXISTS vip boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS user_preference (
  user_id uuid PRIMARY KEY REFERENCES app_user(id),
  home_screen text NOT NULL DEFAULT 'house' CHECK (home_screen IN ('house', 'briefing'))
);

CREATE TABLE IF NOT EXISTS briefing_pin (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  on_date date NOT NULL,
  item_key text NOT NULL,
  action text NOT NULL CHECK (action IN ('pin', 'dismiss')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, user_id, on_date, item_key)
);

CREATE INDEX IF NOT EXISTS briefing_pin_day_idx ON briefing_pin (property_id, on_date);

INSERT INTO permission (code, description) VALUES
  ('briefing.read', 'Open the daily briefing'),
  ('briefing.manage', 'Pin or dismiss briefing items and edit the watch rules')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'briefing.read' FROM role r
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'briefing.manage' FROM role r
WHERE r.code IN (
  'SYSTEM_OWNER', 'GENERAL_MANAGER', 'OPERATIONS_MANAGER', 'ROTA_MANAGER',
  'FRONT_OFFICE_MANAGER', 'RETREAT_MANAGER', 'RESTAURANT_MANAGER'
)
ON CONFLICT DO NOTHING;
