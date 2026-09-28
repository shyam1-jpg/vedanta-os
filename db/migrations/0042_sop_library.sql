-- SOPs can be opened from the admin library, a task, or a department board.
ALTER TABLE staff_sop ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS staff_sop_property_slug
  ON staff_sop (property_id, slug)
  WHERE slug IS NOT NULL AND slug <> '';
