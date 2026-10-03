-- Confirmed supplier invoices attached by staff. No sample invoices, shops, or totals.

CREATE TABLE IF NOT EXISTS invoice_attachment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  property_id uuid NOT NULL REFERENCES property(id),
  filename text NOT NULL,
  mime text NOT NULL,
  file_data text NOT NULL,
  supplier_code text NOT NULL,
  supplier_name text NOT NULL,
  local_shop boolean NOT NULL DEFAULT false,
  invoice_date date NOT NULL,
  total numeric(12,2) NOT NULL CHECK (total > 0),
  booking_id uuid REFERENCES booking_group(id),
  note text,
  entered_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_attachment_property ON invoice_attachment (property_id, invoice_date DESC);
