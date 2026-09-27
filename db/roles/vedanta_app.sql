-- Least-privilege database role for the API. Run this by hand as a superuser or the
-- database owner. Do not point DATABASE_URL at the owner role in production.
-- The API needs to read and write data. It does not need to change the schema,
-- and it must not be able to update or delete the audit log (triggers also block that).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vedanta_app') THEN
    CREATE ROLE vedanta_app LOGIN;
  END IF;
END $$;
-- Set a password outside this file: ALTER ROLE vedanta_app PASSWORD '...';

GRANT CONNECT ON DATABASE vedanta TO vedanta_app;
GRANT USAGE ON SCHEMA public TO vedanta_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vedanta_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vedanta_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vedanta_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO vedanta_app;

REVOKE UPDATE, DELETE, TRUNCATE ON audit_event FROM vedanta_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_chain_head FROM vedanta_app;
GRANT UPDATE (last_hash) ON audit_chain_head TO vedanta_app;
