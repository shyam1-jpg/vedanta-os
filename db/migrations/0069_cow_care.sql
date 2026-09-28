-- Daily care notes for the goshala. Placeholder names only.
-- The bull stays staff only. The cows are never milked. The log stays off until settings say otherwise.

ALTER TABLE seva_animal ADD COLUMN IF NOT EXISTS guest_facing boolean;
ALTER TABLE seva_animal ADD COLUMN IF NOT EXISTS kind text;

UPDATE seva_animal SET guest_facing = (audience = 'guest') WHERE guest_facing IS NULL;
UPDATE seva_animal SET kind = CASE WHEN code = 'example-bull' OR audience = 'staff' THEN 'bull' ELSE 'cow' END WHERE kind IS NULL;
UPDATE seva_animal SET guest_facing = false, audience = 'staff' WHERE kind = 'bull';

ALTER TABLE seva_animal ALTER COLUMN guest_facing SET DEFAULT false;
ALTER TABLE seva_animal ALTER COLUMN kind SET DEFAULT 'cow';

ALTER TABLE seva_slot ADD COLUMN IF NOT EXISTS animal_code text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'seva_animal_bull_hidden'
  ) THEN
    ALTER TABLE seva_animal
      ADD CONSTRAINT seva_animal_bull_hidden CHECK (kind IS DISTINCT FROM 'bull' OR guest_facing = false);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS goshala_day (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  animal_code text NOT NULL,
  on_date date NOT NULL,
  duty_name text NOT NULL DEFAULT '',
  feed_what text NOT NULL DEFAULT '',
  feed_when text NOT NULL DEFAULT '',
  feed_amount text NOT NULL DEFAULT '',
  health_note text NOT NULL DEFAULT '',
  by_user_id uuid REFERENCES app_user(id),
  by_name text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, animal_code, on_date)
);

CREATE INDEX IF NOT EXISTS goshala_day_idx ON goshala_day (property_id, on_date);

CREATE TABLE IF NOT EXISTS goshala_vet (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  animal_code text NOT NULL,
  visit_date date NOT NULL,
  vet_name text NOT NULL,
  reason text NOT NULL,
  outcome text NOT NULL DEFAULT '',
  follow_up date,
  by_user_id uuid REFERENCES app_user(id),
  by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS goshala_vet_idx ON goshala_vet (property_id, animal_code, visit_date);

INSERT INTO permission (code, description) VALUES
  ('goshala.care', 'Keep the goshala daily log and export it')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'goshala.care' FROM role r
WHERE r.code IN (
  'SYSTEM_OWNER', 'GENERAL_MANAGER', 'OPERATIONS_MANAGER',
  'ESTATE_MANAGER', 'GROUNDS_MANAGER', 'GROUNDS', 'GROUNDS_ASSISTANT'
)
ON CONFLICT DO NOTHING;

INSERT INTO goshala_day (tenant_id, property_id, animal_code, on_date, duty_name, feed_what, feed_when, feed_amount, health_note, by_name)
SELECT p.tenant_id, p.id, 'example-daisy', DATE '2026-09-27', 'Example Keeper', 'Hay', '07:30', '2 kg', 'Example note. Calm.', 'Example staff'
FROM property p
WHERE NOT EXISTS (
  SELECT 1 FROM goshala_day d WHERE d.property_id = p.id AND d.animal_code = 'example-daisy' AND d.on_date = DATE '2026-09-27'
);

INSERT INTO goshala_vet (tenant_id, property_id, animal_code, visit_date, vet_name, reason, outcome, follow_up, by_name)
SELECT p.tenant_id, p.id, 'example-bull', DATE '2026-09-01', 'Example Vet', 'Check', 'Example outcome. No treatment.', DATE '2026-12-01', 'Example staff'
FROM property p
WHERE NOT EXISTS (
  SELECT 1 FROM goshala_vet v WHERE v.property_id = p.id AND v.animal_code = 'example-bull' AND v.visit_date = DATE '2026-09-01'
);
