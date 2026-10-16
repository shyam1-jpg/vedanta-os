-- Name the person on handbook rows that were opened without an editor.
UPDATE handbook_article a
SET created_by = owner.id,
    updated_by = owner.id
FROM (
  SELECT DISTINCT ON (m.property_id) m.property_id, u.id
  FROM membership m
  JOIN role r ON r.id = m.role_id AND r.code = 'SYSTEM_OWNER'
  JOIN app_user u ON u.id = m.user_id
  ORDER BY m.property_id, u.created_at
) owner
WHERE a.property_id = owner.property_id
  AND a.created_by IS NULL;

UPDATE handbook_version v
SET edited_by = a.created_by
FROM handbook_article a
WHERE v.article_id = a.id
  AND v.edited_by IS NULL
  AND a.created_by IS NOT NULL;
