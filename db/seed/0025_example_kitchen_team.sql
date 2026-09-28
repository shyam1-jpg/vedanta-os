-- Example kitchen team so a local demo can generate a rota.
-- These are not real people. Real names stay out of git.

DO $$
DECLARE t uuid; p uuid; u uuid; r record;
BEGIN
  SELECT id INTO t FROM tenant LIMIT 1;
  SELECT id INTO p FROM property WHERE tenant_id = t LIMIT 1;
  FOR r IN SELECT * FROM (VALUES
    ('dev.sous@example.invalid', 'Example Sous', 'SOUS_CHEF', 'KITCHEN'),
    ('dev.cdp@example.invalid', 'Example Chef de Partie', 'CHEF_DE_PARTIE', 'KITCHEN'),
    ('dev.cdp.late@example.invalid', 'Example CDP Late', 'CHEF_DE_PARTIE', 'KITCHEN'),
    ('dev.kp.ten@example.invalid', 'Example Porter Ten', 'KITCHEN_PORTER', 'KITCHEN'),
    ('dev.kp.late@example.invalid', 'Example Porter Late', 'KITCHEN_PORTER', 'KITCHEN'),
    ('dev.kp.student@example.invalid', 'Example Porter Student', 'KITCHEN_PORTER', 'KITCHEN'),
    ('dev.ka@example.invalid', 'Example Kitchen Assistant', 'KITCHEN_ASSISTANT', 'KITCHEN')
  ) AS v(email, name, role, dept) LOOP
    INSERT INTO app_user (tenant_id, email, display_name)
    VALUES (t, r.email, r.name)
    ON CONFLICT (tenant_id, email) DO UPDATE SET display_name = EXCLUDED.display_name, status = 'ACTIVE'
    RETURNING id INTO u;
    DELETE FROM membership m USING app_user au WHERE m.user_id = au.id AND au.email = r.email AND m.property_id = p;
    INSERT INTO membership (tenant_id, user_id, property_id, role_id, department_id)
    SELECT t, u, p, ro.id, d.id
    FROM role ro, department d
    WHERE ro.tenant_id = t AND ro.code = r.role AND d.property_id = p AND d.code = r.dept;
  END LOOP;
END $$;

INSERT INTO staff_rota_constraint (user_id, tenant_id, property_id, earliest_start, lates_only, lates_from, never_kp, can_do_kp, opens_kitchen, max_hours_month, earliest_by_weekday, notes)
SELECT u.id, u.tenant_id, p.id, v.earliest::time, v.lates, '12:00', v.never_kp, v.can_kp, v.opens, v.month_cap, v.by_day::jsonb, v.note
FROM property p
JOIN app_user u ON u.tenant_id = p.tenant_id
JOIN (VALUES
  ('dev.cdp.late@example.invalid', NULL::text, false, true, false, false, NULL::numeric, '{"1":"18:00","2":"18:00"}', 'Example: cannot start before 18:00 on Monday or Tuesday'),
  ('dev.kp.ten@example.invalid', '10:00', false, false, true, false, NULL::numeric, '{}', 'Example: earliest start 10:00'),
  ('dev.kp.late@example.invalid', NULL::text, true, false, true, false, NULL::numeric, '{}', 'Example: lates only'),
  ('dev.kp.student@example.invalid', NULL::text, false, false, true, false, 80::numeric, '{}', 'Example: student cap of 80 hours a month')
) AS v(email, earliest, lates, never_kp, can_kp, opens, month_cap, by_day, note) ON lower(u.email) = v.email
ON CONFLICT (user_id) DO UPDATE SET
  earliest_start = EXCLUDED.earliest_start,
  lates_only = EXCLUDED.lates_only,
  never_kp = EXCLUDED.never_kp,
  can_do_kp = EXCLUDED.can_do_kp,
  opens_kitchen = EXCLUDED.opens_kitchen,
  max_hours_month = EXCLUDED.max_hours_month,
  earliest_by_weekday = EXCLUDED.earliest_by_weekday,
  notes = EXCLUDED.notes,
  updated_at = now();
