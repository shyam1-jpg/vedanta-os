-- House organogram: positions of the estate, and the named people who hold them.
-- Idempotent. Sample seats only. Names and addresses are placeholders.

UPDATE department SET name = 'Front of house' WHERE code = 'FRONT';
UPDATE department SET name = 'Estate and grounds' WHERE code = 'GROUNDS';
UPDATE role SET name = 'Ground staff' WHERE code = 'GROUNDS';
UPDATE role SET name = 'Housekeeping' WHERE code = 'HK_ATTENDANT';

INSERT INTO department (tenant_id, property_id, code, name)
SELECT t.id, p.id, 'SALES', 'Sales'
FROM tenant t JOIN property p ON p.tenant_id = t.id
ON CONFLICT (property_id, code) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO role (tenant_id, code, name, approval_limit)
SELECT t.id, v.code, v.name, v.lim
FROM tenant t
CROSS JOIN (VALUES
  ('OPERATIONS_MANAGER', 'Operations manager', 2000.00::numeric),
  ('ROTA_MANAGER', 'Rota manager', NULL::numeric),
  ('RETREAT_MANAGER', 'Retreat manager', 500.00::numeric),
  ('RESTAURANT_MANAGER', 'Restaurant manager', NULL::numeric),
  ('RESTAURANT_SUPERVISOR', 'Restaurant supervisor', NULL::numeric),
  ('RESTAURANT_STAFF', 'Waiter / waitress', NULL::numeric),
  ('KITCHEN_MANAGER', 'Kitchen manager', NULL::numeric),
  ('SOUS_CHEF', 'Sous chef', NULL::numeric),
  ('SENIOR_CHEF_DE_PARTIE', 'Senior chef de partie', NULL::numeric),
  ('CHEF_DE_PARTIE', 'Chef de partie', NULL::numeric),
  ('KITCHEN_APPRENTICE', 'Apprentice', NULL::numeric),
  ('KITCHEN_ASSISTANT', 'Kitchen assistant', NULL::numeric),
  ('KITCHEN_PORTER', 'Kitchen porter', NULL::numeric),
  ('ESTATE_MANAGER', 'Estate manager', NULL::numeric),
  ('ESTATE_ASSISTANT', 'Estate manager assistant', NULL::numeric),
  ('ESTATE_MGMT_ASSISTANT', 'Estate management assistant', NULL::numeric),
  ('GROUNDS_MANAGER', 'Grounds manager', NULL::numeric),
  ('GROUNDS_ASSISTANT', 'Assistant ground staff', NULL::numeric),
  ('SALES_MANAGER', 'Sales manager', 500.00::numeric),
  ('SALES_ASSISTANT', 'Sales assistant', NULL::numeric)
) AS v(code, name, lim)
ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name, approval_limit = EXCLUDED.approval_limit;

-- Pocket + house permissions for the new posts (and HoD / GM signatures).
INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, pm.code FROM role r CROSS JOIN permission pm WHERE
  (pm.code IN ('leave.request','clock.self','sop.read','cover.read') AND r.code IN (
    'OPERATIONS_MANAGER','ROTA_MANAGER','RETREAT_MANAGER','RESTAURANT_MANAGER','RESTAURANT_SUPERVISOR','RESTAURANT_STAFF',
    'KITCHEN_MANAGER','SOUS_CHEF','SENIOR_CHEF_DE_PARTIE','CHEF_DE_PARTIE','KITCHEN_APPRENTICE','KITCHEN_ASSISTANT','KITCHEN_PORTER',
    'ESTATE_MANAGER','ESTATE_ASSISTANT','ESTATE_MGMT_ASSISTANT','GROUNDS_MANAGER','GROUNDS_ASSISTANT','GROUNDS',
    'SALES_MANAGER','SALES_ASSISTANT'
  ))
  OR (pm.code = 'leave.approve_hod' AND r.code IN (
    'FRONT_OFFICE_MANAGER','RETREAT_MANAGER','HK_SUPERVISOR','HEAD_CHEF','KITCHEN_MANAGER','RESTAURANT_MANAGER',
    'ESTATE_MANAGER','GROUNDS_MANAGER','OPERATIONS_MANAGER','MAINTENANCE','SALES_MANAGER','GENERAL_MANAGER','SYSTEM_OWNER'
  ))
  OR (pm.code = 'leave.approve_gm' AND r.code IN ('GENERAL_MANAGER','SYSTEM_OWNER'))
  OR (pm.code IN ('clock.manage','cover.write','sop.manage') AND r.code IN (
    'SYSTEM_OWNER','GENERAL_MANAGER','OPERATIONS_MANAGER','ROTA_MANAGER','FRONT_OFFICE_MANAGER','HK_SUPERVISOR',
    'RESTAURANT_MANAGER','ESTATE_MANAGER'
  ))
  OR (pm.code IN ('tip.manage','hr.read') AND r.code IN ('SYSTEM_OWNER','GENERAL_MANAGER','OPERATIONS_MANAGER','FINANCE_HR'))
  OR (pm.code IN ('group.read','covers.read','guest.read','diet.read') AND r.code IN (
    'RESTAURANT_MANAGER','RESTAURANT_SUPERVISOR','RESTAURANT_STAFF','KITCHEN_MANAGER','SOUS_CHEF',
    'SENIOR_CHEF_DE_PARTIE','CHEF_DE_PARTIE','KITCHEN_APPRENTICE','KITCHEN_ASSISTANT','KITCHEN_PORTER','RETREAT_MANAGER'
  ))
  OR (pm.code IN ('group.read','covers.read') AND r.code IN ('HEAD_CHEF','KITCHEN'))
  OR (pm.code IN ('group.read','maintenance.read','maintenance.work') AND r.code IN (
    'ESTATE_MANAGER','ESTATE_ASSISTANT','ESTATE_MGMT_ASSISTANT','GROUNDS_MANAGER','GROUNDS_ASSISTANT','GROUNDS'
  ))
  OR (pm.code IN ('group.read','group.update','occupancy.write','report.read') AND r.code IN ('OPERATIONS_MANAGER','RETREAT_MANAGER'))
  OR (pm.code IN ('group.read','cover.read') AND r.code = 'ROTA_MANAGER')
  OR (pm.code IN ('group.read','group.create','group.update','guest.read','guest.write','email.send','reservation.read','reservation.create') AND r.code IN ('SALES_MANAGER','SALES_ASSISTANT'))
ON CONFLICT DO NOTHING;

INSERT INTO app_user (tenant_id, email, display_name, status)
SELECT t.id, v.email, v.name, 'ACTIVE'
FROM tenant t
CROSS JOIN (VALUES
  ('gm.house@example.invalid', 'Morgan House'),
  ('estate.house@example.invalid', 'Rowan House'),
  ('hk.lead@example.invalid', 'Quinn House'),
  ('hk.one@example.invalid', 'Avery House'),
  ('hk.two@example.invalid', 'Casey House'),
  ('restaurant.lead@example.invalid', 'Jordan House'),
  ('restaurant.sup@example.invalid', 'Sam House'),
  ('restaurant.one@example.invalid', 'Alex House'),
  ('estate.assist@example.invalid', 'Riley House'),
  ('grounds.one@example.invalid', 'Jamie House'),
  ('sales.one@example.invalid', 'Taylor House')
) AS v(email, name)
ON CONFLICT (tenant_id, email) DO UPDATE SET display_name = EXCLUDED.display_name, status = 'ACTIVE';

-- One role each. Sample people are not system owners.
DELETE FROM membership m
USING app_user u
WHERE m.user_id = u.id AND u.email IN (
  'gm.house@example.invalid','estate.house@example.invalid','hk.lead@example.invalid','hk.one@example.invalid','hk.two@example.invalid',
  'restaurant.lead@example.invalid','restaurant.sup@example.invalid','restaurant.one@example.invalid','estate.assist@example.invalid','grounds.one@example.invalid',
  'sales.one@example.invalid','ops.house@example.invalid'
);

INSERT INTO membership (tenant_id, user_id, property_id, role_id, department_id)
SELECT t.id, u.id, p.id, r.id, d.id
FROM tenant t
JOIN property p ON p.tenant_id = t.id
JOIN app_user u ON u.tenant_id = t.id
JOIN (VALUES
  ('gm.house@example.invalid', 'GENERAL_MANAGER', 'MGMT'),
  ('estate.house@example.invalid', 'ESTATE_MANAGER', 'GROUNDS'),
  ('hk.lead@example.invalid', 'HK_SUPERVISOR', 'HK'),
  ('hk.one@example.invalid', 'HK_ATTENDANT', 'HK'),
  ('hk.two@example.invalid', 'HK_ATTENDANT', 'HK'),
  ('restaurant.lead@example.invalid', 'RESTAURANT_MANAGER', 'RESTAURANT'),
  ('restaurant.sup@example.invalid', 'RESTAURANT_SUPERVISOR', 'RESTAURANT'),
  ('restaurant.one@example.invalid', 'RESTAURANT_STAFF', 'RESTAURANT'),
  ('estate.assist@example.invalid', 'ESTATE_ASSISTANT', 'GROUNDS'),
  ('grounds.one@example.invalid', 'GROUNDS', 'GROUNDS'),
  ('sales.one@example.invalid', 'SALES_MANAGER', 'SALES'),
  ('ops.house@example.invalid', 'OPERATIONS_MANAGER', 'MGMT')
) AS v(email, role, dept) ON lower(u.email) = v.email
JOIN role r ON r.tenant_id = t.id AND r.code = v.role
JOIN department d ON d.property_id = p.id AND d.code = v.dept
WHERE NOT EXISTS (
  SELECT 1 FROM membership m WHERE m.user_id = u.id AND m.property_id = p.id AND m.role_id = r.id
);

INSERT INTO staff_hr (user_id, tenant_id, property_id, designation)
SELECT u.id, u.tenant_id, p.id, v.designation
FROM app_user u
JOIN property p ON p.tenant_id = u.tenant_id
JOIN (VALUES
  ('gm.house@example.invalid', 'General manager'),
  ('estate.house@example.invalid', 'Estate manager — tractor, farming and grounds'),
  ('hk.lead@example.invalid', 'Housekeeping supervisor'),
  ('hk.one@example.invalid', 'Housekeeping'),
  ('hk.two@example.invalid', 'Housekeeping'),
  ('restaurant.lead@example.invalid', 'Restaurant manager'),
  ('restaurant.sup@example.invalid', 'Restaurant supervisor'),
  ('restaurant.one@example.invalid', 'Restaurant staff'),
  ('estate.assist@example.invalid', 'Estate manager assistant'),
  ('grounds.one@example.invalid', 'Ground staff'),
  ('sales.one@example.invalid', 'Sales manager')
) AS v(email, designation) ON lower(u.email) = v.email
ON CONFLICT (user_id) DO UPDATE SET designation = EXCLUDED.designation, updated_at = now();

INSERT INTO staff_sop_assignment (sop_id, user_id)
SELECT s.id, u.id FROM staff_sop s JOIN app_user u ON u.tenant_id = s.tenant_id
ON CONFLICT DO NOTHING;

-- Generic desk logins must not sit in seats that named people already hold.
UPDATE app_user SET status = 'LEFT'
WHERE email IN ('housekeeping@example.invalid', 'chef@example.invalid', 'kitchen@example.invalid')
  AND status <> 'LEFT';
