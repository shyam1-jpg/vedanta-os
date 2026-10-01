-- Additive, booking-linked workflow reviews. Retries for a source version are idempotent.
CREATE TABLE IF NOT EXISTS retreat_workflow_run (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenant(id),
 property_id uuid NOT NULL REFERENCES property(id),
 booking_id uuid NOT NULL REFERENCES booking_group(id),
 source_version integer NOT NULL,
 kind text NOT NULL CHECK (kind IN ('readiness','change')),
 snapshot jsonb NOT NULL,
 review_note text NOT NULL,
 created_by uuid NOT NULL REFERENCES app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (property_id, booking_id, source_version, kind)
);
ALTER TABLE ops_task ADD COLUMN IF NOT EXISTS workflow_run_id uuid REFERENCES retreat_workflow_run(id);
CREATE INDEX IF NOT EXISTS ops_task_booking_idx ON ops_task(property_id, booking_id);
CREATE INDEX IF NOT EXISTS workflow_booking_idx ON retreat_workflow_run(property_id, booking_id, created_at DESC);
ALTER TABLE asset ADD COLUMN IF NOT EXISTS sop_slug text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS ops_handover_ack (
 handover_id uuid NOT NULL REFERENCES ops_handover(id),
 user_id uuid NOT NULL REFERENCES app_user(id),
 acknowledged_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (handover_id,user_id)
);
CREATE TABLE IF NOT EXISTS guest_needs_change (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenant(id),
 property_id uuid NOT NULL REFERENCES property(id),
 enquiry_id uuid NOT NULL REFERENCES guest_enquiry(id),
 changes jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by uuid REFERENCES app_user(id),
 reviewed_at timestamptz,
 review_note text
);
CREATE INDEX IF NOT EXISTS guest_needs_change_pending_idx ON guest_needs_change(property_id,created_at) WHERE reviewed_at IS NULL;
