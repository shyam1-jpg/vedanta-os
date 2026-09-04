-- Migration 0033: Emergency command centre, compliance evidence, asset management

-- Emergency incidents
CREATE TABLE IF NOT EXISTS emergency_incident (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  property_id     uuid NOT NULL REFERENCES property(id),
  kind            text NOT NULL,  -- 'fire'|'medical'|'missing_guest'|'power_failure'|'water_leak'|'evacuation'|'security'|'other'
  severity        text NOT NULL DEFAULT 'amber',  -- 'green'|'amber'|'red'|'critical'
  title           text NOT NULL,
  description     text,
  location        text,
  persons_involved text,
  actions_taken   text,
  emergency_services_called boolean DEFAULT false,
  services_called text,
  resolved_at     timestamptz,
  resolution_notes text,
  reported_by     uuid REFERENCES app_user(id),
  managed_by      uuid REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS emergency_property ON emergency_incident (property_id, created_at DESC);

-- Emergency action log (real-time updates during an incident)
CREATE TABLE IF NOT EXISTS emergency_action (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id     uuid NOT NULL REFERENCES emergency_incident(id) ON DELETE CASCADE,
  action          text NOT NULL,
  taken_by        uuid REFERENCES app_user(id),
  taken_at        timestamptz NOT NULL DEFAULT now()
);

-- Compliance evidence (SOP completion, safety checks, sign-off)
CREATE TABLE IF NOT EXISTS compliance_record (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  property_id     uuid NOT NULL REFERENCES property(id),
  category        text NOT NULL,  -- 'fire_safety'|'food_hygiene'|'legionella'|'health_safety'|'gdpr'|'licensing'|'first_aid'|'other'
  title           text NOT NULL,
  description     text,
  frequency       text,           -- 'daily'|'weekly'|'monthly'|'quarterly'|'annual'|'one_off'
  due_date        date,
  completed_at    timestamptz,
  completed_by    uuid REFERENCES app_user(id),
  evidence_url    text,
  evidence_notes  text,
  passed          boolean,
  failure_notes   text,
  corrective_action text,
  corrective_done_at timestamptz,
  approved_by     uuid REFERENCES app_user(id),
  approved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS compliance_property ON compliance_record (property_id, due_date DESC);
CREATE INDEX IF NOT EXISTS compliance_category ON compliance_record (property_id, category, due_date DESC);

-- Asset register with QR code support
CREATE TABLE IF NOT EXISTS asset (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  property_id     uuid NOT NULL REFERENCES property(id),
  qr_code         text UNIQUE,     -- e.g. VOR-ASSET-00042
  name            text NOT NULL,
  category        text NOT NULL,   -- 'appliance'|'furniture'|'vehicle'|'hvac'|'it'|'kitchen'|'grounds'|'safety'|'other'
  location        text,
  manufacturer    text,
  model           text,
  serial_number   text,
  purchase_date   date,
  purchase_price  numeric(12,2),
  warranty_expires date,
  next_service_date date,
  last_service_date date,
  status          text NOT NULL DEFAULT 'operational', -- 'operational'|'under_maintenance'|'out_of_service'|'disposed'
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asset_property ON asset (property_id, category);
CREATE INDEX IF NOT EXISTS asset_service ON asset (property_id, next_service_date) WHERE next_service_date IS NOT NULL;

-- Asset service history
CREATE TABLE IF NOT EXISTS asset_service_record (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id        uuid NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  kind            text NOT NULL,  -- 'service'|'repair'|'inspection'|'warranty_claim'|'disposal'
  description     text NOT NULL,
  cost            numeric(12,2),
  contractor      text,
  parts_used      text,
  service_date    date NOT NULL,
  next_service_date date,
  done_by         uuid REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asset_service_asset ON asset_service_record (asset_id, service_date DESC);

-- Sustainability tracking
CREATE TABLE IF NOT EXISTS sustainability_reading (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  property_id     uuid NOT NULL REFERENCES property(id),
  reading_date    date NOT NULL,
  category        text NOT NULL,  -- 'electricity_kwh'|'gas_kwh'|'water_litres'|'waste_kg'|'recycling_kg'|'food_waste_kg'|'compost_kg'|'solar_kwh'
  value           numeric(14,3) NOT NULL,
  notes           text,
  recorded_by     uuid REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sustainability_property ON sustainability_reading (property_id, reading_date DESC, category);
