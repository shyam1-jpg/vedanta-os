-- Example training only. No real people.
INSERT INTO training_item (tenant_id, property_id, title, description, category, required_before_unsupervised, certificate, valid_months, example)
SELECT p.tenant_id, p.id, x.title, 'Example — replace this with the house''s own training.', x.category, x.required, x.certificate, x.months, true
FROM property p
CROSS JOIN (
  VALUES
    ('Example fire safety induction', 'fire_safety', true, false, NULL::int),
    ('Example food hygiene level 2', 'food_hygiene', true, true, 36),
    ('Example allergen awareness', 'allergen', true, false, NULL::int),
    ('Example data protection briefing', 'gdpr', true, false, NULL::int),
    ('Example health and safety induction', 'health_safety', true, false, NULL::int),
    ('Example manual handling', 'manual_handling', true, false, NULL::int),
    ('Example COSHH awareness', 'coshh', false, false, NULL::int),
    ('Example role briefing', 'role_specific', false, false, NULL::int)
) AS x(title, category, required, certificate, months)
WHERE NOT EXISTS (
  SELECT 1 FROM training_item i WHERE i.property_id = p.id AND i.title = x.title
);

INSERT INTO training_template (tenant_id, property_id, name, role_code, department, example)
SELECT p.tenant_id, p.id, x.name, x.role, x.dept, true
FROM property p
CROSS JOIN (
  VALUES
    ('Example chef induction', 'HEAD_CHEF', 'KITCHEN'),
    ('Example kitchen porter induction', 'KITCHEN_PORTER', 'KITCHEN'),
    ('Example front of house induction', 'RECEPTIONIST', 'FRONT'),
    ('Example housekeeping induction', 'HK_ATTENDANT', 'HK'),
    ('Example maintenance induction', 'MAINTENANCE', 'MAINT')
) AS x(name, role, dept)
WHERE NOT EXISTS (
  SELECT 1 FROM training_template t WHERE t.property_id = p.id AND t.name = x.name
);

INSERT INTO training_template_item (template_id, item_id)
SELECT t.id, i.id
FROM training_template t
JOIN training_item i ON i.property_id = t.property_id
WHERE t.example AND i.example AND (
  (t.name = 'Example chef induction' AND i.title IN ('Example fire safety induction', 'Example food hygiene level 2', 'Example allergen awareness', 'Example COSHH awareness'))
  OR (t.name = 'Example kitchen porter induction' AND i.title IN ('Example fire safety induction', 'Example food hygiene level 2', 'Example manual handling'))
  OR (t.name = 'Example front of house induction' AND i.title IN ('Example fire safety induction', 'Example allergen awareness', 'Example data protection briefing'))
  OR (t.name = 'Example housekeeping induction' AND i.title IN ('Example fire safety induction', 'Example manual handling', 'Example COSHH awareness'))
  OR (t.name = 'Example maintenance induction' AND i.title IN ('Example fire safety induction', 'Example manual handling', 'Example health and safety induction'))
)
ON CONFLICT DO NOTHING;
