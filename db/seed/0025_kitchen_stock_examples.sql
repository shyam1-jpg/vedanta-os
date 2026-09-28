-- Example stock for the house kitchen. Marked as examples so the kitchen can change them.
INSERT INTO kitchen_stock_item (tenant_id, property_id, name, unit, quantity, low_threshold, notes, example)
SELECT p.tenant_id, p.id, x.name, x.unit, x.quantity, x.low, 'Example — change this to what the kitchen keeps.', true
FROM property p
CROSS JOIN (
  VALUES
    ('Basmati rice', 'kg', 20, 5),
    ('Chickpeas', 'kg', 8, 2),
    ('Ghee', 'kg', 3, 1),
    ('Oat milk', 'litres', 12, 4),
    ('Paper towels', 'packs', 6, 2),
    ('Dishwasher detergent', 'bottles', 2, 1)
) AS x(name, unit, quantity, low)
ON CONFLICT (property_id, name) DO NOTHING;

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'kitchen.stock' FROM role r
WHERE r.code IN (
  'SYSTEM_OWNER','GENERAL_MANAGER','OPERATIONS_MANAGER',
  'HEAD_CHEF','KITCHEN','KITCHEN_MANAGER','SOUS_CHEF','SENIOR_CHEF_DE_PARTIE','CHEF_DE_PARTIE',
  'KITCHEN_APPRENTICE','KITCHEN_ASSISTANT','KITCHEN_PORTER','PURCHASING'
)
ON CONFLICT DO NOTHING;
