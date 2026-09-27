-- Optional guest-facing title. House booking names stay as they are.
-- Brought in from the 27 Sep 2026 folder. Numbered 0037 because 0025 is already
-- the session-management migration on this database.
-- Rollback: ALTER TABLE booking_group DROP COLUMN IF EXISTS public_title;
ALTER TABLE booking_group
  ADD COLUMN IF NOT EXISTS public_title text;
