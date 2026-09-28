-- Guest photo gallery. The public switch lives in property settings and defaults to off.
-- Placeholder drawings are seeded by the API when a property has none, so a local list is not overwritten.

CREATE TABLE IF NOT EXISTS gallery_photo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  category text NOT NULL CHECK (category IN ('grounds', 'goshala', 'kitchen', 'rooms', 'other')),
  title text NOT NULL,
  alt_text text NOT NULL,
  caption text NOT NULL,
  image_src text NOT NULL,
  audience text NOT NULL DEFAULT 'guest' CHECK (audience IN ('guest', 'staff')),
  shows_people boolean NOT NULL DEFAULT false,
  shows_bull boolean NOT NULL DEFAULT false,
  hidden boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 100,
  licence text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gallery_photo_property_idx ON gallery_photo (property_id, sort_order);

INSERT INTO permission (code, description) VALUES
  ('gallery.manage', 'Manage the guest photo gallery')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'gallery.manage' FROM role r
WHERE r.code IN ('SYSTEM_OWNER', 'GENERAL_MANAGER')
ON CONFLICT DO NOTHING;
