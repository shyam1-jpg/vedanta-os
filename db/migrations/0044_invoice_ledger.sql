-- Additive: existing documents remain invoices, originals are retained.
ALTER TABLE invoice_attachment
 ADD COLUMN document_type text NOT NULL DEFAULT 'invoice' CHECK (document_type IN ('invoice','credit')),
 ADD COLUMN invoice_number text NOT NULL DEFAULT '',
 ADD COLUMN purchase_date date,
 ADD COLUMN due_date date,
 ADD COLUMN currency text NOT NULL DEFAULT 'GBP' CHECK (currency = 'GBP'),
 ADD COLUMN subtotal numeric(12,2) CHECK (subtotal >= 0),
 ADD COLUMN vat numeric(12,2) CHECK (vat >= 0),
 ADD COLUMN lines jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) <= 100),
 ADD COLUMN file_sha256 text,
 ADD COLUMN reviewed_at timestamptz;
CREATE UNIQUE INDEX invoice_attachment_file_unique ON invoice_attachment(property_id,file_sha256) WHERE file_sha256 IS NOT NULL;
CREATE UNIQUE INDEX invoice_attachment_number_unique ON invoice_attachment(property_id,lower(trim(supplier_name)),document_type,lower(trim(invoice_number))) WHERE invoice_number <> '';
