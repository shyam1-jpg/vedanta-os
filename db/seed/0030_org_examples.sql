-- Example organisation for the tree. Placeholder names only.
-- A department sub-section, when the house adds one, is a row in department_section.
-- Real people belong in db/import/staff-org.local.json or db/import/staff-teams.local.json, which are gitignored.

INSERT INTO department (tenant_id, property_id, code, name, sort_order)
SELECT t.id, p.id, 'DEVELOPMENT', 'Development', 15
FROM tenant t
JOIN property p ON p.tenant_id = t.id
ON CONFLICT (property_id, code) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order;

INSERT INTO app_user (tenant_id, email, display_name, status)
SELECT t.id, v.email, v.name, 'ACTIVE'
FROM tenant t
CROSS JOIN (VALUES
  ('morgan.example@example.invalid', 'Morgan Example'),
  ('devon.example@example.invalid', 'Devon Example'),
  ('dale.example@example.invalid', 'Dale Example'),
  ('harper.example@example.invalid', 'Harper Example'),
  ('hayden.example@example.invalid', 'Hayden Example'),
  ('harley.example@example.invalid', 'Harley Example'),
  ('kerry.example@example.invalid', 'Kerry Example'),
  ('kit.example@example.invalid', 'Kit Example'),
  ('kim.example@example.invalid', 'Kim Example'),
  ('frankie.example@example.invalid', 'Frankie Example'),
  ('finley.example@example.invalid', 'Finley Example'),
  ('frances.example@example.invalid', 'Frances Example'),
  ('marlow.example@example.invalid', 'Marlow Example'),
  ('moss.example@example.invalid', 'Moss Example'),
  ('mica.example@example.invalid', 'Mica Example')
) AS v(email, name)
ON CONFLICT (tenant_id, email) DO UPDATE SET display_name = EXCLUDED.display_name, status = 'ACTIVE';

INSERT INTO org_position (tenant_id, property_id, department_id, code, title, level, sort_order, example, work_phone, effective_from)
SELECT p.tenant_id, p.id, d.id, v.code, v.title, v.level, v.sort, true, v.phone, DATE '2026-01-01'
FROM property p
JOIN (VALUES
  ('GM', 'General manager', 'gm', 'MGMT', 10, '01632 960100'),
  ('DEV-HEAD', 'Development head', 'head', 'DEVELOPMENT', 10, '01632 960110'),
  ('DEV-LEAD', 'Development lead', 'lead', 'DEVELOPMENT', 20, '01632 960111'),
  ('DEV-STAFF', 'Development assistant', 'staff', 'DEVELOPMENT', 30, NULL),
  ('HK-HEAD', 'Housekeeping head', 'head', 'HK', 10, '01632 960120'),
  ('HK-LEAD', 'Housekeeping lead', 'lead', 'HK', 20, '01632 960121'),
  ('HK-STAFF', 'Housekeeping assistant', 'staff', 'HK', 30, '01632 960122'),
  ('KIT-HEAD', 'Kitchen head', 'head', 'KITCHEN', 10, '01632 960130'),
  ('KIT-LEAD', 'Kitchen lead', 'lead', 'KITCHEN', 20, '01632 960131'),
  ('KIT-STAFF', 'Kitchen assistant', 'staff', 'KITCHEN', 30, '01632 960132'),
  ('FOH-HEAD', 'Front of house head', 'head', 'FRONT', 10, '01632 960140'),
  ('FOH-LEAD', 'Front of house lead', 'lead', 'FRONT', 20, '01632 960141'),
  ('FOH-STAFF', 'Front of house assistant', 'staff', 'FRONT', 30, '01632 960142'),
  ('MAINT-HEAD', 'Maintenance head', 'head', 'MAINT', 10, '01632 960150'),
  ('MAINT-LEAD', 'Maintenance lead', 'lead', 'MAINT', 20, '01632 960151'),
  ('MAINT-STAFF', 'Maintenance assistant', 'staff', 'MAINT', 30, '01632 960152')
) AS v(code, title, level, dept, sort, phone) ON true
JOIN department d ON d.property_id = p.id AND d.code = v.dept
ON CONFLICT (property_id, code) DO UPDATE SET
  title = EXCLUDED.title,
  level = EXCLUDED.level,
  example = true,
  active = true,
  work_phone = EXCLUDED.work_phone;

UPDATE org_position child
SET holder_id = u.id
FROM app_user u, (VALUES
  ('GM', 'morgan.example@example.invalid'),
  ('DEV-HEAD', 'devon.example@example.invalid'),
  ('DEV-LEAD', 'dale.example@example.invalid'),
  ('HK-HEAD', 'harper.example@example.invalid'),
  ('HK-LEAD', 'hayden.example@example.invalid'),
  ('HK-STAFF', 'harley.example@example.invalid'),
  ('KIT-HEAD', 'kerry.example@example.invalid'),
  ('KIT-LEAD', 'kit.example@example.invalid'),
  ('KIT-STAFF', 'kim.example@example.invalid'),
  ('FOH-HEAD', 'frankie.example@example.invalid'),
  ('FOH-LEAD', 'finley.example@example.invalid'),
  ('FOH-STAFF', 'frances.example@example.invalid'),
  ('MAINT-HEAD', 'marlow.example@example.invalid'),
  ('MAINT-LEAD', 'moss.example@example.invalid'),
  ('MAINT-STAFF', 'mica.example@example.invalid')
) AS v(code, email)
WHERE child.code = v.code AND lower(u.email) = v.email AND u.tenant_id = child.tenant_id;

UPDATE org_position child
SET reports_to = parent.id
FROM org_position parent, (VALUES
  ('DEV-HEAD', 'GM'),
  ('DEV-LEAD', 'DEV-HEAD'),
  ('DEV-STAFF', 'DEV-LEAD'),
  ('HK-HEAD', 'GM'),
  ('HK-LEAD', 'HK-HEAD'),
  ('HK-STAFF', 'HK-LEAD'),
  ('KIT-HEAD', 'GM'),
  ('KIT-LEAD', 'KIT-HEAD'),
  ('KIT-STAFF', 'KIT-LEAD'),
  ('FOH-HEAD', 'GM'),
  ('FOH-LEAD', 'FOH-HEAD'),
  ('FOH-STAFF', 'FOH-LEAD'),
  ('MAINT-HEAD', 'GM'),
  ('MAINT-LEAD', 'MAINT-HEAD'),
  ('MAINT-STAFF', 'MAINT-LEAD')
) AS v(child_code, parent_code)
WHERE child.code = v.child_code AND parent.code = v.parent_code AND parent.property_id = child.property_id;

INSERT INTO org_dotted (property_id, from_id, to_id)
SELECT child.property_id, child.id, boss.id
FROM org_position child
JOIN org_position boss ON boss.property_id = child.property_id AND boss.code = 'FOH-HEAD'
WHERE child.code = 'KIT-LEAD'
ON CONFLICT (from_id, to_id) DO NOTHING;
