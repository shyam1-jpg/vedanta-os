-- Handbook folders in hotelkit order, one root entry, one tutorial, one sample handover.
-- Kitchen – Risk Assessments & Training already exists from 0021.

INSERT INTO handbook_chapter (tenant_id, property_id, title, sort_order)
SELECT t.id, p.id, v.title, v.ord
FROM tenant t
JOIN property p ON p.tenant_id = t.id
JOIN (VALUES
  ('Administration', 1),
  ('Emergencies / Safety', 2),
  ('Events & Groups', 3),
  ('F&B', 4),
  ('General Hotel Information', 5),
  ('Housekeeping', 6),
  ('HR & Employee Services', 7),
  ('IT & Systems', 8),
  ('Kitchen – Risk Assessments & Training', 9),
  ('Maintenance', 10),
  ('Marketing & Sales', 11),
  ('Reception / FO', 12),
  ('Estate', 13)
) AS v(title, ord) ON true
WHERE NOT EXISTS (
  SELECT 1 FROM handbook_chapter c WHERE c.property_id = p.id AND c.title = v.title
);

UPDATE handbook_chapter c
SET sort_order = v.ord
FROM (VALUES
  ('Administration', 1),
  ('Emergencies / Safety', 2),
  ('Events & Groups', 3),
  ('F&B', 4),
  ('General Hotel Information', 5),
  ('Housekeeping', 6),
  ('HR & Employee Services', 7),
  ('IT & Systems', 8),
  ('Kitchen – Risk Assessments & Training', 9),
  ('Maintenance', 10),
  ('Marketing & Sales', 11),
  ('Reception / FO', 12),
  ('Estate', 13)
) AS v(title, ord)
WHERE c.title = v.title;

INSERT INTO handbook_article (
  tenant_id, property_id, chapter_id, title, body_html, keywords, audience, status, version, created_by, updated_by
)
SELECT t.id, p.id, NULL,
  'How to use the handbook',
  '<p>Folders along the top of this book are the house categories. Entries on this page sit outside a folder.</p><p>Open a folder for the articles inside it. Each entry keeps its version history.</p>',
  ARRAY['handbook','folders'],
  '{}',
  'live',
  1,
  (SELECT u.id FROM app_user u JOIN membership m ON m.user_id = u.id AND m.property_id = p.id JOIN role r ON r.id = m.role_id AND r.code = 'SYSTEM_OWNER' LIMIT 1),
  (SELECT u.id FROM app_user u JOIN membership m ON m.user_id = u.id AND m.property_id = p.id JOIN role r ON r.id = m.role_id AND r.code = 'SYSTEM_OWNER' LIMIT 1)
FROM tenant t
JOIN property p ON p.tenant_id = t.id
WHERE NOT EXISTS (
  SELECT 1 FROM handbook_article a WHERE a.property_id = p.id AND a.title = 'How to use the handbook'
);

INSERT INTO handbook_version (article_id, version, title, body_html, keywords, edited_by, note)
SELECT a.id, 1, a.title, a.body_html, a.keywords, a.created_by, 'Opened on the handbook home'
FROM handbook_article a
WHERE a.title = 'How to use the handbook'
  AND NOT EXISTS (SELECT 1 FROM handbook_version v WHERE v.article_id = a.id AND v.version = 1);

INSERT INTO ops_tutorial (tenant_id, property_id, title, category, summary, is_new, created_by)
SELECT t.id, p.id,
  'How the house desk works',
  'Getting started',
  'A short orientation: where the handbook, handovers and news live. The owner can add a video link or upload a clip.',
  true,
  (SELECT u.id FROM app_user u JOIN membership m ON m.user_id = u.id AND m.property_id = p.id JOIN role r ON r.id = m.role_id AND r.code = 'SYSTEM_OWNER' LIMIT 1)
FROM tenant t
JOIN property p ON p.tenant_id = t.id
WHERE NOT EXISTS (
  SELECT 1 FROM ops_tutorial x WHERE x.property_id = p.id AND x.title = 'How the house desk works'
);

INSERT INTO ops_handover (
  tenant_id, property_id, department, shift, for_date, body, author_user_id, author_name,
  audience, title, category, visibility, status
)
SELECT t.id, p.id, 'HOUSE', 'am', (timezone('Europe/London', now()))::date,
  'The kitchen pack is in the handbook. Please read it before the next service.',
  u.id, u.display_name, 'shift',
  'Service handover', 'F&B Handovers', 'public', 'live'
FROM tenant t
JOIN property p ON p.tenant_id = t.id
JOIN membership m ON m.property_id = p.id
JOIN role r ON r.id = m.role_id AND r.code = 'SYSTEM_OWNER'
JOIN app_user u ON u.id = m.user_id
WHERE NOT EXISTS (
  SELECT 1 FROM ops_handover h WHERE h.property_id = p.id AND h.title = 'Service handover'
)
LIMIT 1;
