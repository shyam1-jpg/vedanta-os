-- House departments, the Restaurant sub-section, and kitchen role permissions.
-- No real staff names. People are added on Names & positions, or from a local import file.

UPDATE department SET name = 'Front of house', sort_order = 20 WHERE code = 'FRONT';
UPDATE department SET name = 'Housekeeping', sort_order = 30 WHERE code = 'HK';
UPDATE department SET name = 'Kitchen', sort_order = 50 WHERE code = 'KITCHEN';
UPDATE department SET name = 'Restaurant', sort_order = 40 WHERE code = 'RESTAURANT';
UPDATE department SET name = 'Maintenance', sort_order = 70 WHERE code = 'MAINT';
UPDATE department SET name = 'Estate and grounds', sort_order = 60 WHERE code = 'GROUNDS';
UPDATE department SET name = 'Programmes and events', sort_order = 80 WHERE code = 'PROGRAMME';
UPDATE department SET name = 'Purchasing and stores', sort_order = 90 WHERE code = 'PURCHASING';
UPDATE department SET name = 'Finance and HR', sort_order = 100 WHERE code = 'FINANCE';
UPDATE department SET name = 'Management', sort_order = 10 WHERE code = 'MGMT';
UPDATE department SET name = 'Sales', sort_order = 25 WHERE code = 'SALES';

INSERT INTO department (tenant_id, property_id, code, name, sort_order)
SELECT t.id, p.id, 'SALES', 'Sales', 25
FROM tenant t JOIN property p ON p.tenant_id = t.id
ON CONFLICT (property_id, code) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order;

-- Gyms is a sub-section of Restaurant. Rename it in Names & positions if the word is wrong.
INSERT INTO department_section (tenant_id, property_id, department_id, code, name)
SELECT d.tenant_id, d.property_id, d.id, 'GYMS', 'Gyms'
FROM department d
WHERE d.code = 'RESTAURANT'
ON CONFLICT (department_id, code) DO NOTHING;

-- Kitchen posts that plan the kitchen need the rota and the SOP library.
INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, p.code
FROM role r
JOIN permission p ON (
  (r.code = 'HEAD_CHEF' AND p.code IN ('sop.manage', 'sop.read', 'cover.read', 'cover.write', 'clock.manage', 'clock.self', 'leave.request'))
  OR (r.code = 'SOUS_CHEF' AND p.code IN ('sop.read', 'cover.read', 'cover.write', 'clock.manage', 'clock.self', 'leave.request', 'group.read', 'covers.read', 'guest.read', 'diet.read'))
  OR (r.code IN ('CHEF_DE_PARTIE', 'SENIOR_CHEF_DE_PARTIE', 'KITCHEN_PORTER', 'KITCHEN_ASSISTANT') AND p.code IN (
    'sop.read', 'cover.read', 'clock.self', 'leave.request', 'group.read', 'covers.read', 'guest.read', 'diet.read'
  ))
)
ON CONFLICT DO NOTHING;
