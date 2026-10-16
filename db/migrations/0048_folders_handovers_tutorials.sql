-- Handbook entries may sit on the handbook home, outside a folder.
ALTER TABLE handbook_article ALTER COLUMN chapter_id DROP NOT NULL;

ALTER TABLE ops_handover ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE ops_handover ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT '';
ALTER TABLE ops_handover ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public';
ALTER TABLE ops_handover ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'live';
ALTER TABLE ops_handover ADD COLUMN IF NOT EXISTS publish_at timestamptz;
ALTER TABLE ops_handover ADD COLUMN IF NOT EXISTS valid_from date;
ALTER TABLE ops_handover ADD COLUMN IF NOT EXISTS valid_until date;
ALTER TABLE ops_handover ADD COLUMN IF NOT EXISTS recipients_can_edit boolean NOT NULL DEFAULT false;
ALTER TABLE ops_handover ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
ALTER TABLE ops_handover ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE ops_handover DROP CONSTRAINT IF EXISTS ops_handover_visibility_check;
ALTER TABLE ops_handover ADD CONSTRAINT ops_handover_visibility_check CHECK (visibility IN ('public', 'private'));
ALTER TABLE ops_handover DROP CONSTRAINT IF EXISTS ops_handover_status_check;
ALTER TABLE ops_handover ADD CONSTRAINT ops_handover_status_check CHECK (status IN ('draft', 'live'));

CREATE TABLE IF NOT EXISTS ops_handover_recipient (
  handover_id uuid NOT NULL REFERENCES ops_handover(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id),
  PRIMARY KEY (handover_id, user_id)
);

CREATE TABLE IF NOT EXISTS ops_handover_comment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handover_id uuid NOT NULL REFERENCES ops_handover(id) ON DELETE CASCADE,
  author_user_id uuid REFERENCES app_user(id),
  author_name text,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ops_handover_comment_idx ON ops_handover_comment (handover_id, created_at);

CREATE TABLE IF NOT EXISTS ops_handover_file (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handover_id uuid NOT NULL REFERENCES ops_handover(id) ON DELETE CASCADE,
  comment_id uuid REFERENCES ops_handover_comment(id) ON DELETE CASCADE,
  filename text NOT NULL,
  mime text NOT NULL,
  bytes bytea NOT NULL,
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops_handover_template_category (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, title)
);

CREATE TABLE IF NOT EXISTS ops_handover_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  category_id uuid REFERENCES ops_handover_template_category(id) ON DELETE SET NULL,
  title text NOT NULL,
  body_html text NOT NULL DEFAULT '',
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops_saved_filter (
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (user_id, kind)
);

CREATE TABLE IF NOT EXISTS ops_tutorial (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  title text NOT NULL,
  category text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  video_url text,
  filename text,
  mime text,
  bytes bytea,
  is_new boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ops_tutorial_house_idx ON ops_tutorial (property_id, created_at DESC);
