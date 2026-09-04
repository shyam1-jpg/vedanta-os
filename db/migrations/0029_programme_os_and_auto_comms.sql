-- Migration 0029: Programme Operating Sheet
-- One programme record drives kitchen, housekeeping, halls, transport, staffing, maintenance.
-- Linked to booking_group so confirming a booking auto-populates the sheet.

CREATE TABLE IF NOT EXISTS programme (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  property_id     uuid NOT NULL REFERENCES property(id),
  group_id        uuid REFERENCES booking_group(id) ON DELETE CASCADE,
  name            text NOT NULL,
  lead_teacher    text,
  style           text,           -- e.g. 'yoga', 'meditation', 'wellness', 'corporate'
  arrival         date NOT NULL,
  departure       date NOT NULL,
  guests          int,
  rooms_allocated int DEFAULT 0,
  dietary_summary jsonb,          -- {vegan:3, gluten_free:1, ...}
  notes           text,
  status          text NOT NULL DEFAULT 'draft',  -- 'draft' | 'published' | 'archived'
  created_by      uuid REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Daily schedule items (sessions, meals, activities)
CREATE TABLE IF NOT EXISTS programme_item (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  programme_id    uuid NOT NULL REFERENCES programme(id) ON DELETE CASCADE,
  day_offset      int NOT NULL DEFAULT 0,   -- 0=day 1, 1=day 2 etc
  start_time      time NOT NULL,
  end_time        time,
  kind            text NOT NULL,  -- 'session' | 'meal' | 'activity' | 'transfer' | 'free' | 'ceremony'
  title           text NOT NULL,
  location        text,           -- which space/room
  teacher         text,
  covers          int,            -- for meals: number of covers
  notes           text,
  departments     text[],         -- which depts need to act: ['kitchen','housekeeping','halls','transport']
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prog_item_programme ON programme_item (programme_id, day_offset, start_time);
CREATE INDEX IF NOT EXISTS programme_group ON programme (group_id);
CREATE INDEX IF NOT EXISTS programme_property ON programme (property_id, arrival DESC);

-- Department work items auto-generated from programme items
CREATE TABLE IF NOT EXISTS dept_work_item (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  property_id     uuid NOT NULL REFERENCES property(id),
  programme_id    uuid REFERENCES programme(id) ON DELETE CASCADE,
  programme_item_id uuid REFERENCES programme_item(id) ON DELETE CASCADE,
  department      text NOT NULL,
  work_date       date NOT NULL,
  work_time       time,
  title           text NOT NULL,
  description     text,
  assigned_to     uuid REFERENCES app_user(id),
  status          text NOT NULL DEFAULT 'pending',  -- 'pending' | 'in_progress' | 'done' | 'skipped'
  done_at         timestamptz,
  done_by         uuid REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dept_work_dept ON dept_work_item (property_id, department, work_date);
CREATE INDEX IF NOT EXISTS dept_work_programme ON dept_work_item (programme_id);

-- Auto-communications queue
CREATE TABLE IF NOT EXISTS auto_comm (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  property_id     uuid NOT NULL REFERENCES property(id),
  group_id        uuid REFERENCES booking_group(id) ON DELETE CASCADE,
  enquiry_id      uuid REFERENCES guest_enquiry(id) ON DELETE CASCADE,
  kind            text NOT NULL,  -- 'booking_confirmed' | 'balance_reminder' | 'pre_arrival' | 'room_ready' | 'checkout_reminder' | 'feedback'
  scheduled_for   timestamptz NOT NULL,
  sent_at         timestamptz,
  cancelled_at    timestamptz,
  cancel_reason   text,
  outbound_email_id uuid REFERENCES outbound_email(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auto_comm_scheduled ON auto_comm (property_id, scheduled_for) WHERE sent_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS auto_comm_group ON auto_comm (group_id);
