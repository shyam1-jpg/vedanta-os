-- Sessions were keyed only by the secret token. The devices screen asks for an id
-- that can be revoked without handing that secret back to the browser.
ALTER TABLE session ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
UPDATE session SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE session ALTER COLUMN id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS session_id_key ON session (id);
