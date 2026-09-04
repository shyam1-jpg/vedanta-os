-- Migration 0028: payments and folio
-- Full booking lifecycle payments: deposit, balance, refund, invoice, receipt.
-- Linked to booking_group (group stays) and guest_enquiry (private My Stay bookings).

CREATE TABLE IF NOT EXISTS folio (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  property_id     uuid NOT NULL REFERENCES property(id),
  group_id        uuid REFERENCES booking_group(id),
  enquiry_id      uuid REFERENCES guest_enquiry(id),
  guest_id        uuid REFERENCES guest_account(id),
  currency        text NOT NULL DEFAULT 'GBP',
  total_agreed    numeric(12,2),     -- agreed price (from package or manual)
  total_invoiced  numeric(12,2) DEFAULT 0,
  total_paid      numeric(12,2) DEFAULT 0,
  total_refunded  numeric(12,2) DEFAULT 0,
  balance_due     numeric(12,2) GENERATED ALWAYS AS (
                    coalesce(total_agreed,0) - coalesce(total_paid,0) + coalesce(total_refunded,0)
                  ) STORED,
  status          text NOT NULL DEFAULT 'open',  -- 'open' | 'settled' | 'overpaid' | 'cancelled'
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS folio_group ON folio (group_id);
CREATE INDEX IF NOT EXISTS folio_enquiry ON folio (enquiry_id);
CREATE INDEX IF NOT EXISTS folio_property ON folio (property_id, status);

-- Individual payment records
CREATE TABLE IF NOT EXISTS payment (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  folio_id        uuid NOT NULL REFERENCES folio(id),
  kind            text NOT NULL,   -- 'deposit' | 'balance' | 'refund' | 'writeoff' | 'adjustment'
  method          text,            -- 'bank_transfer' | 'card' | 'cash' | 'cheque' | 'stripe'
  amount          numeric(12,2) NOT NULL,
  currency        text NOT NULL DEFAULT 'GBP',
  reference       text,            -- bank ref, Stripe charge ID, cheque number etc.
  note            text,
  due_date        date,
  paid_at         timestamptz,
  recorded_by     uuid REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_folio ON payment (folio_id, created_at);

-- Invoice / receipt documents
CREATE TABLE IF NOT EXISTS invoice (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  folio_id        uuid NOT NULL REFERENCES folio(id),
  number          text NOT NULL,   -- e.g. VOR-2026-0001
  kind            text NOT NULL DEFAULT 'invoice',  -- 'invoice' | 'receipt' | 'credit_note'
  issued_at       date NOT NULL DEFAULT current_date,
  due_date        date,
  amount          numeric(12,2) NOT NULL,
  pdf_url         text,
  sent_at         timestamptz,
  created_by      uuid REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Auto-increment invoice number per property per year
CREATE SEQUENCE IF NOT EXISTS invoice_seq START 1;

CREATE INDEX IF NOT EXISTS invoice_folio ON invoice (folio_id);
CREATE INDEX IF NOT EXISTS invoice_tenant ON invoice (tenant_id, issued_at DESC);

-- Update folio totals trigger
CREATE OR REPLACE FUNCTION update_folio_totals() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE folio SET
    total_paid = (
      SELECT coalesce(sum(amount),0) FROM payment
      WHERE folio_id = NEW.folio_id AND kind NOT IN ('refund','writeoff') AND paid_at IS NOT NULL
    ),
    total_refunded = (
      SELECT coalesce(sum(amount),0) FROM payment
      WHERE folio_id = NEW.folio_id AND kind = 'refund' AND paid_at IS NOT NULL
    ),
    total_invoiced = (
      SELECT coalesce(sum(amount),0) FROM invoice
      WHERE folio_id = NEW.folio_id AND kind = 'invoice'
    ),
    updated_at = now()
  WHERE id = NEW.folio_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_updates_folio ON payment;
CREATE TRIGGER payment_updates_folio
  AFTER INSERT OR UPDATE ON payment
  FOR EACH ROW EXECUTE FUNCTION update_folio_totals();

DROP TRIGGER IF EXISTS invoice_updates_folio ON invoice;
CREATE TRIGGER invoice_updates_folio
  AFTER INSERT OR UPDATE ON invoice
  FOR EACH ROW EXECUTE FUNCTION update_folio_totals();
