-- Obviously fake suppliers. Not a real business, address, or inbox.
INSERT INTO supplier (
  tenant_id, property_id, name, code, contact_name, contact_email, contact_phone, address,
  categories, delivery_days, next_delivery, lead_time_days, notes, example, active
)
SELECT p.tenant_id, p.id, x.name, x.code, 'Example Buyer', x.email, x.phone, '1 Example Lane, Exampletown',
       ARRAY[x.category]::text[], ARRAY[x.day]::text[], (timezone('Europe/London', now()))::date + x.ahead, 2,
       'Example — not a real supplier.', true, true
FROM property p
CROSS JOIN (
  VALUES
    ('Example Dry Goods', 'EX-DRY', 'orders@example-dry-goods.invalid', '01600 000111', 'food', 'mon', 0),
    ('Example Clean Co', 'EX-CLEAN', 'hello@example-clean-co.invalid', '01600 000222', 'cleaning', 'tue', 1),
    ('Example Fixings', 'EX-FIX', 'desk@example-fixings.invalid', '01600 000333', 'maintenance', 'wed', 2),
    ('Example Paper and Soap', 'EX-PAPER', 'orders@example-paper-soap.invalid', '01600 000444', 'consumables', 'fri', 4),
    ('Example Linen Service', 'EX-LINEN', 'rota@example-linen.invalid', '01600 000555', 'services', 'mon', 7)
) AS x(name, code, email, phone, category, day, ahead)
ON CONFLICT (tenant_id, code) DO NOTHING;
