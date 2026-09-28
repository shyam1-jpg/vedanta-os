-- One profile per guest, on the existing person and Guest 360 records.
-- Diet history is kept per stay. Matching, notes, consent, and retention sit beside them.

ALTER TABLE person
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS postcode text,
  ADD COLUMN IF NOT EXISTS guest_account_id uuid REFERENCES guest_account(id),
  ADD COLUMN IF NOT EXISTS merged_into_id uuid REFERENCES person(id),
  ADD COLUMN IF NOT EXISTS erased_at timestamptz;

ALTER TABLE guest_profile
  ADD COLUMN IF NOT EXISTS accessibility_notes text,
  ADD COLUMN IF NOT EXISTS room_preference text,
  ADD COLUMN IF NOT EXISTS special_requests text,
  ADD COLUMN IF NOT EXISTS allergen_keep boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allergen_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS allergen_consent_withdrawn_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_activity_on date,
  ADD COLUMN IF NOT EXISTS profile_marker text,
  ADD COLUMN IF NOT EXISTS profile_purged_at timestamptz,
  ADD COLUMN IF NOT EXISTS allergen_marker text;

ALTER TABLE guest_enquiry
  ADD COLUMN IF NOT EXISTS keep_allergens boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS matched_person_id uuid REFERENCES person(id);

CREATE TABLE IF NOT EXISTS diet_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  person_id uuid NOT NULL REFERENCES person(id),
  group_id uuid REFERENCES booking_group(id) ON DELETE CASCADE,
  arrival date,
  departure date,
  diet text[] NOT NULL DEFAULT '{}',
  allergens text[] NOT NULL DEFAULT '{}',
  severity text,
  notes text,
  allergen_detail text,
  declared_at timestamptz NOT NULL DEFAULT now(),
  retention_marker text,
  purged_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS diet_history_stay_idx ON diet_history (person_id, group_id);

CREATE TABLE IF NOT EXISTS guest_staff_note (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  person_id uuid NOT NULL REFERENCES person(id),
  body text,
  author_user_id uuid REFERENCES app_user(id),
  author_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  retention_marker text,
  purged_at timestamptz
);

CREATE INDEX IF NOT EXISTS guest_staff_note_person_idx ON guest_staff_note (person_id, created_at DESC);

CREATE TABLE IF NOT EXISTS guest_note_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES guest_staff_note(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  action text NOT NULL CHECK (action IN ('create','edit')),
  previous_body text,
  actor_user_id uuid REFERENCES app_user(id),
  actor_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guest_match (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  subject_person_id uuid REFERENCES person(id),
  candidate_person_id uuid NOT NULL REFERENCES person(id),
  strength text NOT NULL CHECK (strength IN ('email','phone','name_dob','name_postcode')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','linked','dismissed','merged')),
  group_id uuid REFERENCES booking_group(id) ON DELETE CASCADE,
  enquiry_id uuid REFERENCES guest_enquiry(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES app_user(id)
);

CREATE INDEX IF NOT EXISTS guest_match_pending_idx ON guest_match (property_id, status);

CREATE TABLE IF NOT EXISTS guest_merge_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  survivor_id uuid NOT NULL REFERENCES person(id),
  merged_id uuid NOT NULL REFERENCES person(id),
  action text NOT NULL CHECK (action IN ('merge','unmerge')),
  snapshot jsonb NOT NULL DEFAULT '{}',
  actor_user_id uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guest_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  person_id uuid NOT NULL REFERENCES person(id),
  user_id uuid REFERENCES app_user(id),
  view text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS guest_access_log_person_idx ON guest_access_log (person_id, created_at DESC);

CREATE TABLE IF NOT EXISTS guest_profile_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  person_id uuid REFERENCES person(id),
  action text NOT NULL,
  detail text,
  actor_user_id uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE guest_feedback ADD COLUMN IF NOT EXISTS retention_marker text;
ALTER TABLE guest_complaint ADD COLUMN IF NOT EXISTS retention_marker text;

INSERT INTO permission (code, description) VALUES
  ('guest.profile.kitchen', 'See diet and allergens on a guest profile'),
  ('guest.profile.front', 'See contact details and preferences on a guest profile'),
  ('guest.profile.manage', 'See and change the full guest profile, including notes, merge, export and erasure')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'guest.profile.kitchen' FROM role r
WHERE r.code IN ('HEAD_CHEF','KITCHEN','KITCHEN_PORTER','KITCHEN_MANAGER','CHEF')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'guest.profile.front' FROM role r
WHERE r.code IN ('RECEPTIONIST','NIGHT_PORTER','SALES_ASSISTANT','SALES_MANAGER','PROGRAMME','RESTAURANT_MANAGER')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'guest.profile.manage' FROM role r
WHERE r.code IN (
  'SYSTEM_OWNER','GENERAL_MANAGER','OPERATIONS_MANAGER','FRONT_OFFICE_MANAGER','FINANCE_HR','RETREAT_MANAGER'
)
ON CONFLICT DO NOTHING;
