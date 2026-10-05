CREATE TABLE planday_connection (
 property_id uuid PRIMARY KEY REFERENCES property(id),
 tenant_id uuid NOT NULL REFERENCES tenant(id),
 client_id text NOT NULL,
 token_encrypted text NOT NULL,
 connected_by uuid NOT NULL REFERENCES app_user(id),
 connected_at timestamptz NOT NULL DEFAULT now(),
 last_attempt_at timestamptz,
 last_synced_at timestamptz,
 snapshot_from date,
 snapshot_to date,
 snapshot jsonb
);
