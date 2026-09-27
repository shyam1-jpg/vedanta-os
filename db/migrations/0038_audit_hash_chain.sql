-- Tamper-evident audit log. Rows can be added. They cannot be updated, deleted or truncated.
-- Each row stores the hash of the previous row. Keys stay in the application; this chain
-- uses pgcrypto, which migration 0001 already enables.
-- A table owner can still disable triggers. Production should run the API as the
-- vedanta_app role in db/roles/vedanta_app.sql, which is not the table owner.

ALTER TABLE audit_event
  ADD COLUMN IF NOT EXISTS prev_hash text,
  ADD COLUMN IF NOT EXISTS row_hash text;

CREATE TABLE IF NOT EXISTS audit_chain_head (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_hash text NOT NULL DEFAULT ''
);
INSERT INTO audit_chain_head (id, last_hash) VALUES (1, '') ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION audit_payload_text(
  prev text,
  tenant_id uuid,
  property_id uuid,
  occurred_at timestamptz,
  actor_user_id uuid,
  actor_type text,
  entity_type text,
  entity_id uuid,
  action text,
  from_state text,
  to_state text,
  reason text,
  entity_version integer,
  trace_id text,
  payload jsonb
) RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT concat_ws(chr(10),
    coalesce(prev, ''),
    coalesce(tenant_id::text, ''),
    coalesce(property_id::text, ''),
    coalesce(occurred_at::text, ''),
    coalesce(actor_user_id::text, ''),
    coalesce(actor_type, ''),
    coalesce(entity_type, ''),
    coalesce(entity_id::text, ''),
    coalesce(action, ''),
    coalesce(from_state, ''),
    coalesce(to_state, ''),
    coalesce(reason, ''),
    coalesce(entity_version::text, ''),
    coalesce(trace_id, ''),
    coalesce(payload::text, '{}')
  );
$$;

-- Fill the chain for rows that already exist, before the guard trigger is attached.
DO $$
DECLARE
  r record;
  prev text := '';
  h text;
BEGIN
  FOR r IN SELECT * FROM audit_event ORDER BY id LOOP
    h := encode(digest(audit_payload_text(
      prev, r.tenant_id, r.property_id, r.occurred_at, r.actor_user_id, r.actor_type,
      r.entity_type, r.entity_id, r.action, r.from_state, r.to_state, r.reason,
      r.entity_version, r.trace_id, r.payload
    ), 'sha256'), 'hex');
    UPDATE audit_event SET prev_hash = prev, row_hash = h WHERE id = r.id;
    prev := h;
  END LOOP;
  UPDATE audit_chain_head SET last_hash = coalesce(prev, '') WHERE id = 1;
END $$;

CREATE OR REPLACE FUNCTION audit_event_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  prev text;
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_event is append-only';
  END IF;

  PERFORM 1 FROM audit_chain_head WHERE id = 1 FOR UPDATE;
  SELECT last_hash INTO prev FROM audit_chain_head WHERE id = 1;
  prev := coalesce(prev, '');
  IF NEW.prev_hash IS NOT NULL AND NEW.prev_hash IS DISTINCT FROM prev THEN
    RAISE EXCEPTION 'audit chain prev_hash does not match the head';
  END IF;
  NEW.prev_hash := prev;
  NEW.row_hash := encode(digest(audit_payload_text(
    NEW.prev_hash, NEW.tenant_id, NEW.property_id, NEW.occurred_at, NEW.actor_user_id, NEW.actor_type,
    NEW.entity_type, NEW.entity_id, NEW.action, NEW.from_state, NEW.to_state, NEW.reason,
    NEW.entity_version, NEW.trace_id, NEW.payload
  ), 'sha256'), 'hex');
  UPDATE audit_chain_head SET last_hash = NEW.row_hash WHERE id = 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_event_guard_trg ON audit_event;
CREATE TRIGGER audit_event_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_guard();

CREATE OR REPLACE FUNCTION audit_event_no_truncate() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_event_no_truncate_trg ON audit_event;
CREATE TRIGGER audit_event_no_truncate_trg
  BEFORE TRUNCATE ON audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION audit_event_no_truncate();

REVOKE UPDATE, DELETE, TRUNCATE ON audit_event FROM PUBLIC;
