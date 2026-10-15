-- Staff operations suite. Additive: existing tasks, handovers, guest requests,
-- maintenance tickets, rooms and bookings keep their current columns and checks.
-- Publishing permission is granted in seed (roles do not exist yet on a fresh database).

ALTER TABLE app_user ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS job_title text;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS birthday date;

ALTER TABLE ops_handover ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'shift';
ALTER TABLE ops_handover ADD COLUMN IF NOT EXISTS recipient_user_id uuid REFERENCES app_user(id);
ALTER TABLE ops_handover ADD COLUMN IF NOT EXISTS audience_group text;
ALTER TABLE ops_handover DROP CONSTRAINT IF EXISTS ops_handover_audience_check;
ALTER TABLE ops_handover ADD CONSTRAINT ops_handover_audience_check CHECK (audience IN ('shift', 'person', 'group'));

ALTER TABLE ops_task ADD COLUMN IF NOT EXISTS show_after timestamptz;
ALTER TABLE ops_task ADD COLUMN IF NOT EXISTS recurrence text NOT NULL DEFAULT 'none';
ALTER TABLE ops_task ADD COLUMN IF NOT EXISTS recurrence_until date;
ALTER TABLE ops_task ADD COLUMN IF NOT EXISTS requires_sign boolean NOT NULL DEFAULT false;
ALTER TABLE ops_task DROP CONSTRAINT IF EXISTS ops_task_recurrence_check;
ALTER TABLE ops_task ADD CONSTRAINT ops_task_recurrence_check CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly'));

CREATE TABLE IF NOT EXISTS ops_task_sign (
  task_id uuid NOT NULL REFERENCES ops_task(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id),
  signed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);

CREATE TABLE IF NOT EXISTS maintenance_photo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES maintenance_ticket(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  filename text NOT NULL,
  mime text NOT NULL,
  bytes bytea NOT NULL,
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS maintenance_photo_ticket_idx ON maintenance_photo (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS handbook_chapter (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  parent_id uuid REFERENCES handbook_chapter(id) ON DELETE SET NULL,
  title text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, title)
);

CREATE TABLE IF NOT EXISTS handbook_article (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  chapter_id uuid NOT NULL REFERENCES handbook_chapter(id) ON DELETE CASCADE,
  title text NOT NULL,
  body_html text NOT NULL DEFAULT '',
  keywords text[] NOT NULL DEFAULT '{}',
  audience text[] NOT NULL DEFAULT '{}',
  review_on date,
  status text NOT NULL DEFAULT 'live' CHECK (status IN ('draft', 'live', 'archived')),
  version int NOT NULL DEFAULT 1,
  created_by uuid REFERENCES app_user(id),
  updated_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS handbook_article_chapter_idx ON handbook_article (chapter_id, title);

CREATE TABLE IF NOT EXISTS handbook_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES handbook_article(id) ON DELETE CASCADE,
  version int NOT NULL,
  title text NOT NULL,
  body_html text NOT NULL,
  keywords text[] NOT NULL DEFAULT '{}',
  edited_by uuid REFERENCES app_user(id),
  edited_at timestamptz NOT NULL DEFAULT now(),
  note text NOT NULL DEFAULT '',
  UNIQUE (article_id, version)
);

CREATE TABLE IF NOT EXISTS handbook_attachment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES handbook_article(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  kind text NOT NULL CHECK (kind IN ('pdf', 'image', 'video')),
  filename text NOT NULL,
  mime text,
  url text,
  bytes bytea,
  storage_key text,
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS handbook_sign (
  article_id uuid NOT NULL REFERENCES handbook_article(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id),
  version int NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (article_id, user_id, version)
);

CREATE TABLE IF NOT EXISTS ops_news (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  title text NOT NULL,
  body text NOT NULL,
  audience text[] NOT NULL DEFAULT '{}',
  author_user_id uuid REFERENCES app_user(id),
  author_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ops_news_house_idx ON ops_news (property_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ops_news_read (
  news_id uuid NOT NULL REFERENCES ops_news(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id),
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (news_id, user_id)
);

CREATE TABLE IF NOT EXISTS ops_idea (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'General',
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'considering', 'planned', 'done', 'declined')),
  author_user_id uuid REFERENCES app_user(id),
  author_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ops_idea_house_idx ON ops_idea (property_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS ops_idea_comment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id uuid NOT NULL REFERENCES ops_idea(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  body text NOT NULL,
  author_user_id uuid REFERENCES app_user(id),
  author_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops_appointment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  audience text[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ops_appointment_house_idx ON ops_appointment (property_id, starts_at);

CREATE TABLE IF NOT EXISTS hk_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  room_id uuid NOT NULL REFERENCES room(id) ON DELETE CASCADE,
  on_date date NOT NULL,
  assignee_user_id uuid REFERENCES app_user(id),
  occupancy text NOT NULL DEFAULT 'vacant' CHECK (occupancy IN ('vacant', 'occupied', 'arrival', 'departure', 'stayover')),
  clean_type text NOT NULL DEFAULT 'full' CHECK (clean_type IN ('full', 'stayover', 'linen', 'none')),
  updated_by uuid REFERENCES app_user(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, on_date)
);
CREATE INDEX IF NOT EXISTS hk_assignment_day_idx ON hk_assignment (property_id, on_date);

CREATE TABLE IF NOT EXISTS ops_moment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  body text NOT NULL,
  author_user_id uuid REFERENCES app_user(id),
  author_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  href text NOT NULL DEFAULT '',
  actor_user_id uuid REFERENCES app_user(id),
  actor_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ops_activity_house_idx ON ops_activity (property_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ops_notification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  href text NOT NULL DEFAULT '',
  audience text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops_notification_read (
  notification_id uuid NOT NULL REFERENCES ops_notification(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id),
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);

ALTER TABLE guest_complaint ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open';
ALTER TABLE guest_complaint ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '';
ALTER TABLE guest_complaint ADD COLUMN IF NOT EXISTS room_label text NOT NULL DEFAULT '';
ALTER TABLE guest_complaint ADD COLUMN IF NOT EXISTS guest_name text NOT NULL DEFAULT '';
ALTER TABLE guest_complaint DROP CONSTRAINT IF EXISTS guest_complaint_status_check;
ALTER TABLE guest_complaint ADD CONSTRAINT guest_complaint_status_check
  CHECK (status IN ('open', 'acknowledged', 'resolving', 'resolved', 'closed'));

INSERT INTO permission (code, description) VALUES
  ('content.publish', 'Publish handbook, news, ideas, calendar and the home feed')
ON CONFLICT DO NOTHING;
