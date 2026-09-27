-- Write permissions that must not be implied by a read permission.
-- Department boards, front-of-house orders and the house log each have their own write right.
-- Finance can read the house. Finance cannot edit boards, orders or the log.
-- Task approval stays on task.approve (already separate from task.write).

INSERT INTO permission (code, description) VALUES
  ('board.write', 'Edit a department board and its photos'),
  ('foh.order', 'Raise and update front-of-house orders to the kitchen'),
  ('log.write', 'Write the house log: handover, notices, checklist ticks and guest requests')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'board.write'
FROM role r
WHERE r.code IN (
  'SYSTEM_OWNER', 'GENERAL_MANAGER', 'OPERATIONS_MANAGER', 'FRONT_OFFICE_MANAGER', 'RECEPTIONIST',
  'HK_SUPERVISOR', 'HEAD_CHEF', 'KITCHEN_MANAGER', 'RESTAURANT_MANAGER', 'RETREAT_MANAGER',
  'ESTATE_MANAGER', 'GROUNDS_MANAGER', 'MAINTENANCE'
)
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'foh.order'
FROM role r
WHERE r.code IN (
  'SYSTEM_OWNER', 'GENERAL_MANAGER', 'OPERATIONS_MANAGER', 'FRONT_OFFICE_MANAGER', 'RECEPTIONIST',
  'HEAD_CHEF', 'KITCHEN', 'KITCHEN_MANAGER', 'RESTAURANT_MANAGER'
)
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_code)
SELECT DISTINCT r.id, 'log.write'
FROM role r
JOIN role_permission rp ON rp.role_id = r.id
WHERE rp.permission_code IN ('group.read', 'cover.read', 'covers.read')
  AND r.code <> 'FINANCE_HR'
ON CONFLICT DO NOTHING;
