-- Chat, notifications, leave accounts, schedule audit, payslip files and profile preferences.

ALTER TABLE rota_shift ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE rota_shift ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES app_user(id);
ALTER TABLE rota_template_line ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES app_user(id);

ALTER TABLE leave_account ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'annual';
ALTER TABLE leave_account DROP CONSTRAINT IF EXISTS leave_account_pkey;
ALTER TABLE leave_account ADD PRIMARY KEY (user_id, year, kind);
ALTER TABLE leave_account ADD COLUMN IF NOT EXISTS valid_from date;
ALTER TABLE leave_account ADD COLUMN IF NOT EXISTS valid_until date;
ALTER TABLE leave_account ADD COLUMN IF NOT EXISTS accruing_rate numeric(6,2) NOT NULL DEFAULT 0;
ALTER TABLE leave_account ADD COLUMN IF NOT EXISTS start_balance numeric(6,2) NOT NULL DEFAULT 0;
ALTER TABLE leave_account ADD COLUMN IF NOT EXISTS accrued numeric(8,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS wf_leave_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES property(id),
  code text NOT NULL,
  name text NOT NULL,
  method text NOT NULL CHECK (method IN ('fixed', 'hourly')),
  days numeric(6,2) NOT NULL DEFAULT 0,
  accrual_percent numeric(6,2) NOT NULL DEFAULT 0,
  UNIQUE (property_id, code)
);

CREATE TABLE IF NOT EXISTS wf_contract_rule (
  property_id uuid PRIMARY KEY REFERENCES property(id),
  weekly_cap numeric(5,1) NOT NULL DEFAULT 48,
  default_contracted numeric(5,1) NOT NULL DEFAULT 37.5,
  break_minutes int NOT NULL DEFAULT 30
);

CREATE TABLE IF NOT EXISTS wf_overtime_rule (
  property_id uuid PRIMARY KEY REFERENCES property(id),
  after_hours numeric(5,1) NOT NULL DEFAULT 48,
  multiplier numeric(4,2) NOT NULL DEFAULT 1.5
);

CREATE TABLE IF NOT EXISTS wf_chat (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  kind text NOT NULL CHECK (kind IN ('direct', 'group')),
  title text NOT NULL DEFAULT '',
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wf_chat_member (
  chat_id uuid NOT NULL REFERENCES wf_chat(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  last_read_at timestamptz,
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS wf_chat_message (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES wf_chat(id) ON DELETE CASCADE,
  author_user_id uuid REFERENCES app_user(id),
  body text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'voice', 'photo', 'video', 'gif')),
  filename text NOT NULL DEFAULT '',
  mime text NOT NULL DEFAULT '',
  bytes bytea,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wf_chat_message_idx ON wf_chat_message (chat_id, created_at);

CREATE TABLE IF NOT EXISTS wf_notification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES property(id),
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  href text NOT NULL DEFAULT '/workforce/',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wf_notification_user_idx ON wf_notification (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rota_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES property(id),
  actor_user_id uuid REFERENCES app_user(id),
  action text NOT NULL,
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rota_audit_house_idx ON rota_audit (property_id, created_at DESC);

ALTER TABLE payslip ADD COLUMN IF NOT EXISTS filename text NOT NULL DEFAULT '';
ALTER TABLE payslip ADD COLUMN IF NOT EXISTS mime text NOT NULL DEFAULT '';
ALTER TABLE payslip ADD COLUMN IF NOT EXISTS bytes bytea;

ALTER TABLE staff_document ADD COLUMN IF NOT EXISTS folder text NOT NULL DEFAULT 'General';
ALTER TABLE staff_document ADD COLUMN IF NOT EXISTS mime text NOT NULL DEFAULT '';
ALTER TABLE staff_document ADD COLUMN IF NOT EXISTS bytes bytea;

ALTER TABLE app_user ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '';
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'en';
ALTER TABLE wf_digest_pref ADD COLUMN IF NOT EXISTS email_notifications boolean NOT NULL DEFAULT true;

ALTER TABLE ops_news ADD COLUMN IF NOT EXISTS department text NOT NULL DEFAULT '';
ALTER TABLE ops_news ADD COLUMN IF NOT EXISTS staff_group text NOT NULL DEFAULT '';
ALTER TABLE ops_appointment ADD COLUMN IF NOT EXISTS department text NOT NULL DEFAULT '';
ALTER TABLE ops_appointment ADD COLUMN IF NOT EXISTS staff_group text NOT NULL DEFAULT '';
