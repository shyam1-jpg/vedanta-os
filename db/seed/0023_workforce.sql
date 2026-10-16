-- Sample week so the workforce desk and the pocket are not empty.

UPDATE app_user SET birthday = (current_date + 1)
WHERE email = 'dev.kitchen@example.invalid' AND birthday IS NULL;

INSERT INTO leave_account (user_id, property_id, year, allowance_days, carried_days)
SELECT u.id, m.property_id, extract(year from current_date)::int, 28, 0
FROM app_user u
JOIN membership m ON m.user_id = u.id
JOIN role r ON r.id = m.role_id AND r.code IN ('SYSTEM_OWNER', 'KITCHEN', 'HK_SUPERVISOR')
WHERE NOT EXISTS (
  SELECT 1 FROM leave_account a WHERE a.user_id = u.id AND a.year = extract(year from current_date)::int
);

INSERT INTO rota_shift (tenant_id, property_id, user_id, department, shift_date, start_time, end_time, break_minutes, status, notes, position, shift_type, published, created_by)
SELECT t.id, p.id, u.id, 'KITCHEN', current_date, '07:00', '15:00', 30, 'scheduled', 'Breakfast and lunch service', 'Chef de partie', 'shift', true, owner.id
FROM tenant t
JOIN property p ON p.tenant_id = t.id
JOIN app_user u ON u.email = 'dev.kitchen@example.invalid'
JOIN app_user owner ON owner.email = 'dev.owner@example.invalid'
WHERE NOT EXISTS (
  SELECT 1 FROM rota_shift s WHERE s.property_id = p.id AND s.user_id = u.id AND s.shift_date = current_date AND s.start_time = '07:00'
);

INSERT INTO rota_shift (tenant_id, property_id, user_id, department, shift_date, start_time, end_time, break_minutes, status, notes, position, shift_type, published, created_by)
SELECT t.id, p.id, NULL, 'KITCHEN', current_date + 1, '09:00', '17:00', 30, 'scheduled', 'Open — cover the pass', 'Chef de partie', 'open', true, owner.id
FROM tenant t
JOIN property p ON p.tenant_id = t.id
JOIN app_user owner ON owner.email = 'dev.owner@example.invalid'
WHERE NOT EXISTS (
  SELECT 1 FROM rota_shift s WHERE s.property_id = p.id AND s.user_id IS NULL AND s.shift_date = current_date + 1 AND s.department = 'KITCHEN'
);

INSERT INTO rota_shift (tenant_id, property_id, user_id, department, shift_date, start_time, end_time, break_minutes, status, notes, position, shift_type, published, created_by)
SELECT t.id, p.id, owner.id, 'MGMT', current_date + 2, '10:00', '14:00', 0, 'scheduled', 'Draft until the rota is published', 'Duty manager', 'shift', false, owner.id
FROM tenant t
JOIN property p ON p.tenant_id = t.id
JOIN app_user owner ON owner.email = 'dev.owner@example.invalid'
WHERE NOT EXISTS (
  SELECT 1 FROM rota_shift s WHERE s.property_id = p.id AND s.published = false AND s.department = 'MGMT'
);

INSERT INTO shift_request (tenant_id, property_id, kind, shift_id, requester_id, note, status)
SELECT s.tenant_id, s.property_id, 'swap', s.id, s.user_id, 'Can someone take breakfast?', 'pending'
FROM rota_shift s
JOIN app_user u ON u.id = s.user_id AND u.email = 'dev.kitchen@example.invalid'
WHERE s.shift_date = current_date AND s.start_time = '07:00'
  AND NOT EXISTS (SELECT 1 FROM shift_request r WHERE r.shift_id = s.id AND r.kind = 'swap');

INSERT INTO absence_request (tenant_id, property_id, user_id, kind, from_date, to_date, days, notes, status)
SELECT t.id, p.id, u.id, 'holiday', current_date + 14, current_date + 16, 3, 'Family visit', 'pending'
FROM tenant t
JOIN property p ON p.tenant_id = t.id
JOIN app_user u ON u.email = 'dev.kitchen@example.invalid'
WHERE NOT EXISTS (
  SELECT 1 FROM absence_request a WHERE a.user_id = u.id AND a.from_date = current_date + 14
);

INSERT INTO payslip (tenant_id, property_id, user_id, period_label, period_start, period_end, gross_pence, net_pence, summary)
SELECT t.id, p.id, u.id, 'September 2026', '2026-09-01', '2026-09-30', 214000, 171200, 'Contracted kitchen hours. Tax and NI already taken off. This is a view, not a payroll run.'
FROM tenant t
JOIN property p ON p.tenant_id = t.id
JOIN app_user u ON u.email = 'dev.kitchen@example.invalid'
WHERE NOT EXISTS (SELECT 1 FROM payslip x WHERE x.user_id = u.id AND x.period_label = 'September 2026');

INSERT INTO rota_template (tenant_id, property_id, title, department, created_by)
SELECT t.id, p.id, 'Kitchen week', 'KITCHEN', owner.id
FROM tenant t
JOIN property p ON p.tenant_id = t.id
JOIN app_user owner ON owner.email = 'dev.owner@example.invalid'
WHERE NOT EXISTS (SELECT 1 FROM rota_template x WHERE x.property_id = p.id AND x.title = 'Kitchen week');

INSERT INTO rota_template_line (template_id, weekday, start_time, end_time, break_minutes, position, notes)
SELECT x.id, v.weekday, '09:00', '17:00', 30, 'Chef de partie', 'From the kitchen week template'
FROM rota_template x
JOIN (VALUES (1), (2), (3), (4), (5)) AS v(weekday) ON true
WHERE x.title = 'Kitchen week'
  AND NOT EXISTS (SELECT 1 FROM rota_template_line l WHERE l.template_id = x.id);

INSERT INTO wf_message (tenant_id, property_id, author_user_id, subject, body_html, require_reply, show_on_clock)
SELECT t.id, p.id, owner.id, 'Please confirm you saw the rota', '<p>The breakfast shift is on the board. Reply here so I know you have it.</p>', true, true
FROM tenant t
JOIN property p ON p.tenant_id = t.id
JOIN app_user owner ON owner.email = 'dev.owner@example.invalid'
WHERE NOT EXISTS (SELECT 1 FROM wf_message m WHERE m.property_id = p.id AND m.subject = 'Please confirm you saw the rota');

INSERT INTO wf_message_target (message_id, user_id, folder)
SELECT m.id, u.id, 'inbox'
FROM wf_message m
JOIN app_user u ON u.email = 'dev.kitchen@example.invalid'
WHERE m.subject = 'Please confirm you saw the rota'
  AND NOT EXISTS (SELECT 1 FROM wf_message_target t WHERE t.message_id = m.id AND t.user_id = u.id);

INSERT INTO ops_news (tenant_id, property_id, title, body, author_user_id, author_name)
SELECT t.id, p.id, 'Rota week is open', 'Check Workforce for open shifts before Friday.', owner.id, owner.display_name
FROM tenant t
JOIN property p ON p.tenant_id = t.id
JOIN app_user owner ON owner.email = 'dev.owner@example.invalid'
WHERE NOT EXISTS (SELECT 1 FROM ops_news n WHERE n.property_id = p.id AND n.title = 'Rota week is open');

INSERT INTO ops_appointment (tenant_id, property_id, title, body, location, starts_at, ends_at, created_by)
SELECT t.id, p.id, 'Fire drill', 'Whole house, ten minutes.', 'Front lawn', (current_date + 3) + time '15:00', (current_date + 3) + time '15:30', owner.id
FROM tenant t
JOIN property p ON p.tenant_id = t.id
JOIN app_user owner ON owner.email = 'dev.owner@example.invalid'
WHERE NOT EXISTS (SELECT 1 FROM ops_appointment a WHERE a.property_id = p.id AND a.title = 'Fire drill');
