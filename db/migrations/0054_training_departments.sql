-- Department-scoped training modules, shared modules, and a versioned checklist.
-- Fire safety is one locked module on every department. Checklist edits keep ticks.

ALTER TABLE training_item
  ADD COLUMN IF NOT EXISTS share text NOT NULL DEFAULT 'department',
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checklist_version integer NOT NULL DEFAULT 1;

ALTER TABLE training_item DROP CONSTRAINT IF EXISTS training_item_share_check;
ALTER TABLE training_item ADD CONSTRAINT training_item_share_check CHECK (share IN ('department', 'selected', 'all'));

DO $$
DECLARE cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  WHERE con.conrelid = 'training_item'::regclass
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%category%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE training_item DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE training_item ADD CONSTRAINT training_item_category_check CHECK (category IN (
  'fire_safety', 'food_hygiene', 'allergen', 'gdpr', 'health_safety', 'manual_handling', 'coshh',
  'hygiene', 'knife', 'guest_service', 'accessibility', 'equipment', 'cleaning',
  'role_specific', 'other'
));

CREATE TABLE IF NOT EXISTS training_module_dept (
  item_id uuid NOT NULL REFERENCES training_item(id) ON DELETE CASCADE,
  department text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, department)
);

CREATE TABLE IF NOT EXISTS training_check (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES training_item(id) ON DELETE CASCADE,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS training_check_item_idx ON training_check (item_id, sort_order);

CREATE TABLE IF NOT EXISTS training_tick (
  assignment_id uuid NOT NULL REFERENCES training_assignment(id) ON DELETE CASCADE,
  check_id uuid NOT NULL REFERENCES training_check(id) ON DELETE CASCADE,
  ticked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, check_id)
);

ALTER TABLE training_assignment
  ADD COLUMN IF NOT EXISTS signed_off_version integer;
