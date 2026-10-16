-- Shreyas works housekeeping and the kitchen. His week is already near the 48 hour cap
-- so a dragged shift onto him is refused, while the same shift can land on someone else.

INSERT INTO app_user (tenant_id, email, display_name, status)
SELECT t.id, 'shreyas.mirle@example.invalid', 'Shreyas Mirle', 'ACTIVE'
FROM tenant t
WHERE NOT EXISTS (SELECT 1 FROM app_user u WHERE u.email = 'shreyas.mirle@example.invalid');

INSERT INTO membership (tenant_id, user_id, property_id, role_id, department_id)
SELECT t.id, u.id, p.id, r.id, d.id
FROM tenant t
JOIN property p ON p.tenant_id = t.id
JOIN app_user u ON u.email = 'shreyas.mirle@example.invalid'
JOIN role r ON r.tenant_id = t.id AND r.code = 'HK_ATTENDANT'
JOIN department d ON d.property_id = p.id AND d.code = 'HK'
WHERE NOT EXISTS (
  SELECT 1 FROM membership m WHERE m.user_id = u.id AND m.property_id = p.id AND m.role_id = r.id
);

INSERT INTO staff_department (user_id, property_id, department)
SELECT u.id, p.id, v.department
FROM app_user u
JOIN property p ON p.tenant_id = u.tenant_id
JOIN (VALUES ('HK'), ('KITCHEN')) AS v(department) ON true
WHERE u.email = 'shreyas.mirle@example.invalid'
ON CONFLICT DO NOTHING;

INSERT INTO rota_shift (tenant_id, property_id, user_id, department, shift_date, start_time, end_time, break_minutes, notes, position, shift_type, published, created_by)
SELECT t.id, p.id, u.id, v.department, date_trunc('week', current_date)::date + v.day_no, '09:00', '18:00', 0,
       'Across housekeeping and the kitchen', v.position, 'shift', true, owner.id
FROM tenant t
JOIN property p ON p.tenant_id = t.id
JOIN app_user u ON u.email = 'shreyas.mirle@example.invalid'
JOIN app_user owner ON owner.email = 'dev.owner@example.invalid'
JOIN (VALUES
  (0, 'KITCHEN', 'Chef de partie'),
  (1, 'KITCHEN', 'Chef de partie'),
  (2, 'KITCHEN', 'Chef de partie'),
  (3, 'HK', 'Room attendant'),
  (4, 'HK', 'Room attendant')
) AS v(day_no, department, position) ON true
WHERE NOT EXISTS (
  SELECT 1 FROM rota_shift s WHERE s.user_id = u.id AND s.shift_date = date_trunc('week', current_date)::date + v.day_no AND s.department = v.department
);

INSERT INTO staff_availability (user_id, property_id, on_date, available, note)
SELECT u.id, p.id, current_date + 1, false, 'Cannot do the late kitchen'
FROM app_user u
JOIN property p ON p.tenant_id = u.tenant_id
WHERE u.email = 'dev.kitchen@example.invalid'
ON CONFLICT (user_id, on_date) DO UPDATE SET available = false, note = EXCLUDED.note;

INSERT INTO absence_request (tenant_id, property_id, user_id, kind, from_date, to_date, days, notes, status)
SELECT t.id, p.id, u.id, 'holiday', current_date + 1, current_date + 1, 1, 'Leave clash for the rota warning', 'pending'
FROM tenant t
JOIN property p ON p.tenant_id = t.id
JOIN app_user u ON u.email = 'dev.kitchen@example.invalid'
WHERE NOT EXISTS (
  SELECT 1 FROM absence_request a WHERE a.user_id = u.id AND a.from_date = current_date + 1 AND a.notes = 'Leave clash for the rota warning'
);
