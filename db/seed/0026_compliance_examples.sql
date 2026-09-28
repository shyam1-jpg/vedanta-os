-- Example compliance dates. Marked as examples so the house can replace them.
INSERT INTO permission (code, description) VALUES
  ('compliance.calendar', 'See and update the compliance calendar')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'compliance.calendar' FROM role r
ON CONFLICT DO NOTHING;

INSERT INTO compliance_item (tenant_id, property_id, title, category, repeating, every_n, every_unit, next_due, example)
SELECT p.tenant_id, p.id, x.title, x.category, true, x.every_n, x.unit, (timezone('Europe/London', now()))::date + x.ahead, true
FROM property p
CROSS JOIN (
  VALUES
    ('Fire suppression and extinguisher service', 'fire_safety', 1, 'year', 40),
    ('Fire alarm test', 'fire_safety', 1, 'week', 3),
    ('Food hygiene inspection', 'food_safety', 1, 'year', 20),
    ('GDPR review', 'gdpr', 1, 'year', 60),
    ('Insurance renewal', 'insurance', 1, 'year', 14),
    ('PAT testing', 'equipment', 1, 'year', 90),
    ('Gas safety', 'health_safety', 1, 'year', 100),
    ('Legionella risk assessment', 'health_safety', 1, 'year', 50),
    ('Fridge and freezer calibration', 'food_safety', 6, 'month', 10)
) AS x(title, category, every_n, unit, ahead)
WHERE NOT EXISTS (
  SELECT 1 FROM compliance_item i WHERE i.property_id = p.id AND i.title = x.title
);
