-- Planday-style workforce on top of the existing rota, clock and leave tables.
ALTER TABLE rota_shift ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE rota_shift ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT true;
ALTER TABLE rota_shift ADD COLUMN IF NOT EXISTS position text NOT NULL DEFAULT '';
ALTER TABLE rota_shift ADD COLUMN IF NOT EXISTS shift_type text NOT NULL DEFAULT 'shift';
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS birthday date;

CREATE TABLE IF NOT EXISTS rota_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  title text NOT NULL,
  department text NOT NULL,
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rota_template_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES rota_template(id) ON DELETE CASCADE,
  weekday int NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  break_minutes int NOT NULL DEFAULT 30,
  position text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS staff_availability (
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES property(id),
  on_date date NOT NULL,
  available boolean NOT NULL DEFAULT true,
  note text NOT NULL DEFAULT '',
  locked boolean NOT NULL DEFAULT false,
  locked_by uuid REFERENCES app_user(id),
  PRIMARY KEY (user_id, on_date)
);

CREATE TABLE IF NOT EXISTS shift_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  kind text NOT NULL CHECK (kind IN ('swap', 'claim')),
  shift_id uuid NOT NULL REFERENCES rota_shift(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES app_user(id),
  counterpart_id uuid REFERENCES app_user(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  note text NOT NULL DEFAULT '',
  decided_by uuid REFERENCES app_user(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shift_request_house_idx ON shift_request (property_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS leave_account (
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES property(id),
  year int NOT NULL,
  allowance_days numeric(5,1) NOT NULL DEFAULT 28,
  carried_days numeric(5,1) NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, year)
);

CREATE TABLE IF NOT EXISTS payslip (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  period_label text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  gross_pence int NOT NULL DEFAULT 0,
  net_pence int NOT NULL DEFAULT 0,
  summary text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wf_message (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  author_user_id uuid REFERENCES app_user(id),
  subject text NOT NULL DEFAULT '',
  body_html text NOT NULL DEFAULT '',
  require_reply boolean NOT NULL DEFAULT false,
  show_on_clock boolean NOT NULL DEFAULT false,
  parent_id uuid REFERENCES wf_message(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wf_message_house_idx ON wf_message (property_id, created_at DESC);

CREATE TABLE IF NOT EXISTS wf_message_target (
  message_id uuid NOT NULL REFERENCES wf_message(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  folder text NOT NULL DEFAULT 'inbox',
  read_at timestamptz,
  acknowledged_at timestamptz,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS wf_message_file (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES wf_message(id) ON DELETE CASCADE,
  filename text NOT NULL,
  mime text NOT NULL,
  bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wf_push (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL DEFAULT '',
  auth_key text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wf_push_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wf_sms_hook (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES property(id),
  to_phone text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'stub',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wf_digest_pref (
  user_id uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  digest boolean NOT NULL DEFAULT false
);
