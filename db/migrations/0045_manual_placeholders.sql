-- House manual: keep every existing chapter, and move the earlier seeded
-- chapters out of the default list. Title, summary, body, steps, diagram,
-- and status are not changed. New placeholder sections are inserted by the
-- API only when their slug is missing (on conflict do nothing).

ALTER TABLE house_manual
  ADD COLUMN IF NOT EXISTS catalogue text NOT NULL DEFAULT 'current';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'house_manual_catalogue_check'
  ) THEN
    ALTER TABLE house_manual
      ADD CONSTRAINT house_manual_catalogue_check
      CHECK (catalogue IN ('current', 'archive'));
  END IF;
END $$;

UPDATE house_manual
SET catalogue = 'archive'
WHERE catalogue = 'current'
  AND slug IN (
    'app-how-to-use',
    'app-receive-and-act',
    'house-how-we-meet',
    'front-desk-day',
    'night-porter',
    'hk-room',
    'kitchen-brigade',
    'kitchen-safety',
    'kitchen-open-close',
    'restaurant-service',
    'maint-faults',
    'grounds-estate',
    'mgmt-the-board'
  );
