-- Migration 0031: Purchasing & supplier workflow
-- Requisition → approval → PO → delivery → quality check → invoice → 3-way match

CREATE TABLE IF NOT EXISTS supplier (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  property_id     uuid NOT NULL REFERENCES property(id),
  name            text NOT NULL,
  code            text NOT NULL,
  contact_name    text,
  contact_email   text,
  contact_phone   text,
  address         text,
  payment_terms   int DEFAULT 30,   -- days
  currency        text DEFAULT 'GBP',
  active          boolean NOT NULL DEFAULT true,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS purchase_requisition (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  property_id     uuid NOT NULL REFERENCES property(id),
  department      text NOT NULL,
  title           text NOT NULL,
  notes           text,
  urgency         text NOT NULL DEFAULT 'normal',  -- 'normal'|'urgent'|'critical'
  required_by     date,
  status          text NOT NULL DEFAULT 'draft',   -- 'draft'|'submitted'|'approved'|'ordered'|'declined'
  requested_by    uuid REFERENCES app_user(id),
  approved_by     uuid REFERENCES app_user(id),
  approved_at     timestamptz,
  decline_reason  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS requisition_item (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id  uuid NOT NULL REFERENCES purchase_requisition(id) ON DELETE CASCADE,
  description     text NOT NULL,
  quantity        numeric(10,3) NOT NULL,
  unit            text,
  unit_price      numeric(12,2),
  supplier_id     uuid REFERENCES supplier(id),
  notes           text
);

CREATE TABLE IF NOT EXISTS purchase_order (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  property_id     uuid NOT NULL REFERENCES property(id),
  number          text NOT NULL,      -- e.g. PO-2026-0001
  requisition_id  uuid REFERENCES purchase_requisition(id),
  supplier_id     uuid NOT NULL REFERENCES supplier(id),
  department      text NOT NULL,
  order_date      date NOT NULL DEFAULT current_date,
  expected_delivery date,
  status          text NOT NULL DEFAULT 'sent',  -- 'sent'|'partially_delivered'|'delivered'|'invoiced'|'cancelled'
  total_net       numeric(12,2),
  total_vat       numeric(12,2),
  total_gross     numeric(12,2),
  notes           text,
  created_by      uuid REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS po_number ON purchase_order (tenant_id, number);

CREATE TABLE IF NOT EXISTS po_item (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id           uuid NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
  description     text NOT NULL,
  quantity_ordered numeric(10,3) NOT NULL,
  quantity_received numeric(10,3) DEFAULT 0,
  unit            text,
  unit_price      numeric(12,2) NOT NULL,
  vat_rate        numeric(5,2) DEFAULT 20,
  received_at     timestamptz,
  quality_ok      boolean
);

-- Supplier invoice (for 3-way match: PO + delivery + invoice)
CREATE TABLE IF NOT EXISTS supplier_invoice (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  property_id     uuid NOT NULL REFERENCES property(id),
  po_id           uuid REFERENCES purchase_order(id),
  supplier_id     uuid NOT NULL REFERENCES supplier(id),
  invoice_number  text NOT NULL,
  invoice_date    date NOT NULL,
  due_date        date,
  total_net       numeric(12,2) NOT NULL,
  total_vat       numeric(12,2) DEFAULT 0,
  total_gross     numeric(12,2) NOT NULL,
  status          text NOT NULL DEFAULT 'received', -- 'received'|'matched'|'disputed'|'paid'|'cancelled'
  match_status    text,       -- '3way_ok'|'price_variance'|'qty_variance'|'no_po'
  paid_at         date,
  payment_ref     text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE SEQUENCE IF NOT EXISTS po_seq START 1;
