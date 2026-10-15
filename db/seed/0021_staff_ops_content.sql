-- Handbook chapter, kitchen risk-assessment article, and event ideas.
-- Runs after the property exists. Publishing is limited to the owner and general manager.

INSERT INTO handbook_chapter (tenant_id, property_id, title, sort_order)
SELECT t.id, p.id, 'Kitchen – Risk Assessments & Training', 10
FROM tenant t
JOIN property p ON p.tenant_id = t.id
WHERE NOT EXISTS (
  SELECT 1 FROM handbook_chapter c WHERE c.property_id = p.id AND c.title = 'Kitchen – Risk Assessments & Training'
);

INSERT INTO handbook_article (
  tenant_id, property_id, chapter_id, title, body_html, keywords, audience, review_on, status, version
)
SELECT t.id, p.id, c.id,
  'Kitchen risk assessments',
  '<p>The kitchen risk assessments and training pack for the house. Read the attached PDF, then confirm you have read it.</p><p>Vegetarian kitchen: no eggs, onion, garlic, leeks, spring onions or chives. Allergen controls sit with the head chef.</p>',
  ARRAY['kitchen','risk','training','haccp','safety'],
  '{}',
  (timezone('Europe/London', now()))::date + 365,
  'live',
  1
FROM tenant t
JOIN property p ON p.tenant_id = t.id
JOIN handbook_chapter c ON c.property_id = p.id AND c.title = 'Kitchen – Risk Assessments & Training'
WHERE NOT EXISTS (
  SELECT 1 FROM handbook_article a WHERE a.property_id = p.id AND a.title = 'Kitchen risk assessments'
);

INSERT INTO handbook_version (article_id, version, title, body_html, keywords, note)
SELECT a.id, 1, a.title, a.body_html, a.keywords, 'First issue, with the kitchen pack attached.'
FROM handbook_article a
WHERE a.title = 'Kitchen risk assessments'
  AND NOT EXISTS (SELECT 1 FROM handbook_version v WHERE v.article_id = a.id AND v.version = 1);

INSERT INTO handbook_attachment (article_id, tenant_id, property_id, kind, filename, mime, storage_key)
SELECT a.id, a.tenant_id, a.property_id, 'pdf',
  'Vedanta_Kitchen_Risk_Assessments_ALL_1830.pdf',
  'application/pdf',
  'kitchen-risk-assessments.pdf'
FROM handbook_article a
WHERE a.title = 'Kitchen risk assessments'
  AND NOT EXISTS (
    SELECT 1 FROM handbook_attachment x WHERE x.article_id = a.id AND x.storage_key = 'kitchen-risk-assessments.pdf'
  );

INSERT INTO ops_idea (tenant_id, property_id, title, body, category, status, author_name)
SELECT t.id, p.id, v.title, v.body, 'Events', 'new', 'House'
FROM tenant t
JOIN property p ON p.tenant_id = t.id
CROSS JOIN (VALUES
  ('Digital Detox Night', 'A gong bath, a quiet night''s sleep and sunrise yoga with breakfast. No phones.'),
  ('Bring Your Own Question', 'A small-group chat with a Vedanta teacher about what''s really on your mind.'),
  ('Sunrise to Sunset Vow Day', 'Yoga, silence, simple food and journalling, ending with a fire ceremony.'),
  ('Local Day Retreats', 'Yoga, a talk, lunch and a garden walk, just outside Lincoln.'),
  ('Festival Weekends', 'Diwali, Janmashtami and Holi with music, colour and a big feast.'),
  ('Team Wellbeing Days', 'Mindfulness, a fresh vegetarian lunch and quiet space for your team.'),
  ('Love & Light (Valentine''s)', 'Partner yoga, a candlelit dinner and diya lighting, with a self-love version for friends.'),
  ('Thank You Amma (Mother''s Day)', 'A special lunch, a flower garland and relaxing yoga nidra for mums.'),
  ('Father''s Day Garden Morning', 'Gardening with Dad, a short talk and a hearty lunch.'),
  ('New Year Intentions', 'Meditation and a fire ceremony to start the year, then a feast.'),
  ('Full Moon Nights', 'Monthly outdoor meditation, then hot chai.')
) AS v(title, body)
WHERE NOT EXISTS (
  SELECT 1 FROM ops_idea i WHERE i.property_id = p.id AND i.title = v.title
);

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'content.publish'
FROM role r
WHERE r.code IN ('SYSTEM_OWNER', 'GENERAL_MANAGER')
ON CONFLICT DO NOTHING;
