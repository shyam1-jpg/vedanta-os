-- Guest-band staffing and draft rotas. Shift rules live in tables so the house can edit them.
-- A shift may be unfilled: that is a gap, not a missing row.

CREATE TABLE IF NOT EXISTS rota_house_rule (
  property_id uuid PRIMARY KEY REFERENCES property(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  normal_week_hours numeric(6,2) NOT NULL DEFAULT 40,
  hours_include_break boolean NOT NULL DEFAULT true,
  late_finish time NOT NULL DEFAULT '21:00',
  blocked_next_start time NOT NULL DEFAULT '07:00',
  default_break_minutes int NOT NULL DEFAULT 30,
  max_consecutive_days int NOT NULL DEFAULT 6,
  max_days_per_week int
);

CREATE TABLE IF NOT EXISTS staffing_band (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  department_code text NOT NULL,
  label text NOT NULL,
  min_guests int NOT NULL,
  max_guests int,
  placeholder boolean NOT NULL DEFAULT false,
  note text,
  sort_order int NOT NULL DEFAULT 0,
  UNIQUE (property_id, department_code, min_guests)
);

CREATE TABLE IF NOT EXISTS staffing_shift (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  band_id uuid NOT NULL REFERENCES staffing_band(id) ON DELETE CASCADE,
  code text NOT NULL,
  label text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  break_minutes int NOT NULL DEFAULT 30,
  headcount int NOT NULL DEFAULT 1,
  role_codes text[] NOT NULL DEFAULT '{}',
  is_kp boolean NOT NULL DEFAULT false,
  is_opener boolean NOT NULL DEFAULT false,
  note text,
  sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rota_role_default (
  property_id uuid NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  role_code text NOT NULL,
  never_kp boolean NOT NULL DEFAULT false,
  can_do_kp boolean NOT NULL DEFAULT false,
  opens_kitchen boolean NOT NULL DEFAULT false,
  PRIMARY KEY (property_id, role_code)
);

CREATE TABLE IF NOT EXISTS rota_constraint_template (
  code text PRIMARY KEY,
  label text NOT NULL,
  detail text NOT NULL,
  body jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_rota_constraint (
  user_id uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  earliest_start time,
  lates_only boolean NOT NULL DEFAULT false,
  lates_from time NOT NULL DEFAULT '12:00',
  never_kp boolean,
  can_do_kp boolean,
  opens_kitchen boolean,
  max_hours_week numeric(6,2),
  max_hours_month numeric(6,2),
  normal_week_hours numeric(6,2),
  max_days_week int,
  unavailable_weekdays int[] NOT NULL DEFAULT '{}',
  earliest_by_weekday jsonb NOT NULL DEFAULT '{}',
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rota_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  guest_counts jsonb NOT NULL DEFAULT '{}',
  notes text,
  created_by uuid REFERENCES app_user(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, week_start)
);

ALTER TABLE rota_shift ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE rota_shift ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES rota_plan(id) ON DELETE CASCADE;
ALTER TABLE rota_shift ADD COLUMN IF NOT EXISTS shift_code text;
ALTER TABLE rota_shift ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE rota_shift ADD COLUMN IF NOT EXISTS gap boolean NOT NULL DEFAULT false;
ALTER TABLE rota_shift ADD COLUMN IF NOT EXISTS gap_reason text;
ALTER TABLE rota_shift ADD COLUMN IF NOT EXISTS lieu_hours numeric(6,2) NOT NULL DEFAULT 0;
ALTER TABLE rota_shift ADD COLUMN IF NOT EXISTS placeholder boolean NOT NULL DEFAULT false;
