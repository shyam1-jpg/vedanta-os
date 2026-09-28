-- Editable department modules. One Fire safety module for every department.
-- Chemical safety is the same module on maintenance and housekeeping. No real people.

INSERT INTO training_item (
  tenant_id, property_id, title, description, category, required_before_unsupervised,
  certificate, valid_months, example, share, locked
)
SELECT p.tenant_id, p.id, x.title, 'Example — edit this to match the house. It is not a finished course.',
       x.category, x.required, x.certificate, x.months, true, x.share, x.locked
FROM property p
CROSS JOIN (
  VALUES
    ('Fire safety', 'fire_safety', true, true, 12, 'all', true),
    ('Food safety', 'food_hygiene', true, true, 36, 'department', false),
    ('Allergen awareness', 'allergen', true, false, NULL::int, 'department', false),
    ('Hygiene', 'hygiene', true, false, NULL::int, 'department', false),
    ('Knife skills', 'knife', true, false, NULL::int, 'department', false),
    ('Guest service', 'guest_service', true, false, NULL::int, 'department', false),
    ('Accessibility awareness', 'accessibility', true, false, NULL::int, 'department', false),
    ('Equipment handling', 'equipment', true, false, NULL::int, 'department', false),
    ('Chemical safety (COSHH)', 'coshh', true, false, NULL::int, 'selected', false),
    ('Cleaning standards', 'cleaning', true, false, NULL::int, 'department', false)
) AS x(title, category, required, certificate, months, share, locked)
WHERE NOT EXISTS (
  SELECT 1 FROM training_item i WHERE i.property_id = p.id AND i.title = x.title
);

INSERT INTO training_module_dept (item_id, department, sort_order)
SELECT i.id, d.code, 0
FROM training_item i
JOIN department d ON d.property_id = i.property_id
WHERE i.title = 'Fire safety' AND i.locked
ON CONFLICT DO NOTHING;

INSERT INTO training_module_dept (item_id, department, sort_order)
SELECT i.id, x.department, x.sort_order
FROM training_item i
JOIN (
  VALUES
    ('Food safety', 'KITCHEN', 1),
    ('Allergen awareness', 'KITCHEN', 2),
    ('Hygiene', 'KITCHEN', 3),
    ('Knife skills', 'KITCHEN', 4),
    ('Guest service', 'FRONT', 1),
    ('Accessibility awareness', 'FRONT', 2),
    ('Equipment handling', 'MAINT', 1),
    ('Chemical safety (COSHH)', 'MAINT', 2),
    ('Chemical safety (COSHH)', 'HK', 2),
    ('Cleaning standards', 'HK', 1)
) AS x(title, department, sort_order) ON x.title = i.title
ON CONFLICT DO NOTHING;

INSERT INTO training_check (item_id, label, sort_order)
SELECT i.id, x.label, x.sort_order
FROM training_item i
JOIN (
  VALUES
    ('Fire safety', 0, 'Find the fire exits and the assembly point'),
    ('Fire safety', 1, 'Raise the alarm and call for help'),
    ('Fire safety', 2, 'Use an extinguisher only if you are trained and it is safe'),
    ('Food safety', 0, 'Wash hands before handling food'),
    ('Food safety', 1, 'Keep hot food hot and cold food cold'),
    ('Food safety', 2, 'Keep allergens away from the food they do not belong in'),
    ('Allergen awareness', 0, 'Read the allergen on the booking before service'),
    ('Allergen awareness', 1, 'Know the severe and anaphylactic marks'),
    ('Allergen awareness', 2, 'Tell a manager if a guest''s diet is unclear'),
    ('Hygiene', 0, 'Wear clean work clothes'),
    ('Hygiene', 1, 'Keep the bench and the sink clean'),
    ('Hygiene', 2, 'Cover a cut and change gloves'),
    ('Knife skills', 0, 'Carry a knife point down'),
    ('Knife skills', 1, 'Use a stable board'),
    ('Knife skills', 2, 'Store knives in the rack, not in a sink of water'),
    ('Guest service', 0, 'Greet the guest and use their name'),
    ('Guest service', 1, 'Know today''s arrivals and who needs assistance'),
    ('Guest service', 2, 'Pass a problem to the right department'),
    ('Accessibility awareness', 0, 'Ask what help the guest wants'),
    ('Accessibility awareness', 1, 'Keep routes clear'),
    ('Accessibility awareness', 2, 'Know which rooms have step-free access'),
    ('Equipment handling', 0, 'Check a machine is isolated before you work on it'),
    ('Equipment handling', 1, 'Use the right tool'),
    ('Equipment handling', 2, 'Report a fault before you leave it'),
    ('Chemical safety (COSHH)', 0, 'Read the label and the COSHH sheet'),
    ('Chemical safety (COSHH)', 1, 'Wear the protection the sheet asks for'),
    ('Chemical safety (COSHH)', 2, 'Store chemicals in the locked cupboard'),
    ('Cleaning standards', 0, 'Clean a departure room to the checklist'),
    ('Cleaning standards', 1, 'Keep clean and used linen apart'),
    ('Cleaning standards', 2, 'Report damage before the next guest')
) AS x(title, sort_order, label) ON x.title = i.title
WHERE NOT EXISTS (
  SELECT 1 FROM training_check c WHERE c.item_id = i.id AND c.label = x.label
);
