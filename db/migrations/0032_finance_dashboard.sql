-- Migration 0032: Finance dashboard
-- Revenue, food cost, labour cost, occupancy, ADR, RevPAR, budget variance.
-- Views computed from existing tables — no new data entry required.

-- Monthly budget targets (set by management)
CREATE TABLE IF NOT EXISTS budget (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  property_id     uuid NOT NULL REFERENCES property(id),
  year            int NOT NULL,
  month           int NOT NULL,  -- 1-12
  category        text NOT NULL, -- 'revenue'|'food_cost'|'labour_cost'|'maintenance_spend'|'supplier_spend'
  amount          numeric(14,2) NOT NULL,
  notes           text,
  created_by      uuid REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, year, month, category)
);

-- Finance summary view — revenue from folios, costs from purchasing and payroll
CREATE OR REPLACE VIEW finance_monthly AS
SELECT
  p.id AS property_id,
  date_trunc('month', g.arrival_date::timestamptz)::date AS month,
  count(DISTINCT g.id) AS bookings,
  sum(g.expected_guests) AS guest_nights,
  count(DISTINCT g.id) FILTER (WHERE g.status IN ('CONFIRMED','IN_HOUSE','COMPLETED')) AS confirmed_bookings,
  coalesce(sum(f.total_paid), 0) AS revenue_received,
  coalesce(sum(f.total_agreed), 0) AS revenue_agreed,
  coalesce(sum(f.balance_due), 0) AS balance_outstanding,
  -- ADR = revenue / guest nights
  CASE WHEN sum(g.expected_guests) > 0
    THEN round(sum(f.total_agreed) / sum(g.expected_guests), 2)
  END AS adr,
  -- Occupancy = guest nights / (guest_rooms * days_in_month)
  CASE WHEN (SELECT count(*) FROM room r WHERE r.property_id = p.id AND NOT r.staff_only) > 0
    THEN round(100.0 * sum(g.expected_guests) / (
      (SELECT count(*) FROM room r WHERE r.property_id = p.id AND NOT r.staff_only) *
      extract(days FROM date_trunc('month', g.arrival_date::timestamptz) + interval '1 month' - date_trunc('month', g.arrival_date::timestamptz))
    ), 1)
  END AS occupancy_pct
FROM property p
LEFT JOIN booking_group g ON g.property_id = p.id AND g.status NOT IN ('CANCELLED','ENQUIRY')
LEFT JOIN folio f ON f.group_id = g.id
GROUP BY p.id, date_trunc('month', g.arrival_date::timestamptz)::date;

-- Purchasing spend by department/month view
CREATE OR REPLACE VIEW purchasing_monthly AS
SELECT
  po.property_id,
  date_trunc('month', po.order_date::timestamptz)::date AS month,
  po.department,
  count(*) AS orders,
  coalesce(sum(po.total_gross), 0) AS total_spend
FROM purchase_order po
WHERE po.status != 'cancelled'
GROUP BY po.property_id, date_trunc('month', po.order_date::timestamptz)::date, po.department;
