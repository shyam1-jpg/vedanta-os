-- Example staffing can name a day type, a season, and why the number was chosen.
-- Grounds acreage is a house setting. The example assumes 15–20 acres.
-- staffing_customised stops a later seed from overwriting a manager's edits.

ALTER TABLE rota_house_rule
  ADD COLUMN IF NOT EXISTS grounds_acres_min int NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS grounds_acres_max int NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS staffing_seed text,
  ADD COLUMN IF NOT EXISTS staffing_customised boolean NOT NULL DEFAULT false;

ALTER TABLE staffing_band
  ADD COLUMN IF NOT EXISTS basis text,
  ADD COLUMN IF NOT EXISTS sources text,
  ADD COLUMN IF NOT EXISTS example boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS weekday_office boolean NOT NULL DEFAULT false;

ALTER TABLE staffing_shift
  ADD COLUMN IF NOT EXISTS day_kind text NOT NULL DEFAULT 'always',
  ADD COLUMN IF NOT EXISTS months int[];
