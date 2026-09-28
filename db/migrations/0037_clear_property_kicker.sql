-- The public brand is the house name. An empty kicker stops "Retreat Center"
-- being repeated above it. Historical seeds are left as they were.
UPDATE property
SET settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{kicker}', '""'::jsonb, true);
