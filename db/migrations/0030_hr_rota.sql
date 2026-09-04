-- Migration 0030: HR & Rota
-- Staff scheduling, clock-in/out, holiday, sickness, overtime, training, documents, qualifications.

-- Rota shifts
CREATE TABLE IF NOT EXISTS rota_shift (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  property_id     uuid NOT NULL REFERENCES property(id),
  user_id         uuid NOT NULL REFERENCES app_user(id),
  department      text NOT NULL,
  role_code       text,
  shift_date      date NOT NULL,
  start_time      time NOT NULL,
  end_time        time NOT NULL,
  break_minutes   int NOT NULL DEFAULT 30,
  status          text NOT NULL DEFAULT 'scheduled', -- 'scheduled'|'confirmed'|'swapped'|'cancelled'
  notes           text,
  created_by      uuid REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rota_shift_date ON rota_shift (property_id, shift_date, department);
CREATE INDEX IF NOT EXISTS rota_shift_user ON rota_shift (user_id, shift_date);

-- Clock-in/out records
CREATE TABLE IF NOT EXISTS clock_record (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  property_id     uuid NOT NULL REFERENCES property(id),
  user_id         uuid NOT NULL REFERENCES app_user(id),
  shift_id        uuid REFERENCES rota_shift(id),
  clocked_in_at   timestamptz NOT NULL DEFAULT now(),
  clocked_out_at  timestamptz,
  break_minutes   int DEFAULT 0,
  notes           text,
  approved_by     uuid REFERENCES app_user(id),
  approved_at     timestamptz
);
CREATE INDEX IF NOT EXISTS clock_record_user ON clock_record (user_id, clocked_in_at DESC);
CREATE INDEX IF NOT EXISTS clock_record_property ON clock_record (property_id, clocked_in_at DESC);

-- Holiday / absence requests
CREATE TABLE IF NOT EXISTS absence_request (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  property_id     uuid NOT NULL REFERENCES property(id),
  user_id         uuid NOT NULL REFERENCES app_user(id),
  kind            text NOT NULL DEFAULT 'holiday', -- 'holiday'|'sickness'|'compassionate'|'unpaid'|'other'
  from_date       date NOT NULL,
  to_date         date NOT NULL,
  days            numeric(4,1),
  notes           text,
  status          text NOT NULL DEFAULT 'pending', -- 'pending'|'approved'|'declined'|'cancelled'
  approved_by     uuid REFERENCES app_user(id),
  approved_at     timestamptz,
  decline_reason  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS absence_user ON absence_request (user_id, from_date DESC);
CREATE INDEX IF NOT EXISTS absence_property ON absence_request (property_id, from_date DESC);

-- Training records and qualifications
CREATE TABLE IF NOT EXISTS training_record (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  property_id     uuid NOT NULL REFERENCES property(id),
  user_id         uuid NOT NULL REFERENCES app_user(id),
  title           text NOT NULL,
  kind            text NOT NULL DEFAULT 'internal', -- 'internal'|'external'|'certification'|'induction'
  completed_at    date,
  expires_at      date,           -- for certificates that need renewal
  certificate_ref text,
  notes           text,
  recorded_by     uuid REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS training_user ON training_record (user_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS training_expiry ON training_record (property_id, expires_at) WHERE expires_at IS NOT NULL;

-- Staff documents (contracts, DBS, right to work, etc.)
CREATE TABLE IF NOT EXISTS staff_document (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  property_id     uuid NOT NULL REFERENCES property(id),
  user_id         uuid NOT NULL REFERENCES app_user(id),
  kind            text NOT NULL, -- 'contract'|'dbs'|'right_to_work'|'p45'|'p60'|'other'
  title           text NOT NULL,
  expires_at      date,
  file_url        text,
  notes           text,
  uploaded_by     uuid REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_doc_user ON staff_document (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS staff_doc_expiry ON staff_document (property_id, expires_at) WHERE expires_at IS NOT NULL;
