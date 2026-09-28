-- Synthetic retreat clients for the organiser room list.
-- Names are placeholders. Emails use example.invalid. Not real guests.

INSERT INTO person (id, tenant_id, given_name, family_name, email, organisation, notes)
VALUES
  ('55555555-5555-4555-8555-555555555551', 'dbe8f12b-5577-472e-bd6e-5d749962aade', 'Test', 'Client 01', 'test.client.01@example.invalid', 'Example Retreat Circle', 'Synthetic attendee. Not a real person.'),
  ('55555555-5555-4555-8555-555555555552', 'dbe8f12b-5577-472e-bd6e-5d749962aade', 'Test', 'Client 02', 'test.client.02@example.invalid', 'Example Retreat Circle', 'Synthetic attendee. Not a real person.'),
  ('55555555-5555-4555-8555-555555555553', 'dbe8f12b-5577-472e-bd6e-5d749962aade', 'Test', 'Client 03', 'test.client.03@example.invalid', 'Example Spring Circle', 'Synthetic attendee. Not a real person.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO booking_group (
  id, tenant_id, property_id, name, organisation, contact_email,
  arrival_date, arrival_slot, departure_date, departure_slot, retreat_type, use_basis,
  expected_guests, expected_rooms, status, booking_form_status, notes, colour, source, version
) VALUES (
  '66666666-6666-4666-8666-666666666666',
  'dbe8f12b-5577-472e-bd6e-5d749962aade',
  '0e663f34-d4ce-4f40-899c-11f1866047fd',
  'Example Spring Retreat',
  'Example Spring Circle',
  'spring.organiser@example.invalid',
  '2026-11-02', 'PM', '2026-11-06', 'AM',
  'residential', 'SHARED', 4, 2, 'CONFIRMED', 'COMPLETE',
  'Synthetic sample for development. Not a real booking.',
  '#8A6A3B', 'SYNTHETIC', 1
) ON CONFLICT (id) DO NOTHING;

INSERT INTO diet_profile (tenant_id, person_id, diet, allergens, severity, notes)
VALUES
  ('dbe8f12b-5577-472e-bd6e-5d749962aade', '55555555-5555-4555-8555-555555555551', '{vegetarian}', '{soya}', 'INTOLERANCE', 'Synthetic allergen record.')
ON CONFLICT (person_id) DO NOTHING;

INSERT INTO group_attendee (tenant_id, group_id, person_id, room_preference, arrives_early, share_consent, needs_access)
VALUES
  ('dbe8f12b-5577-472e-bd6e-5d749962aade', '11111111-1111-4111-8111-111111111111', '55555555-5555-4555-8555-555555555551', 'single', false, false, true),
  ('dbe8f12b-5577-472e-bd6e-5d749962aade', '11111111-1111-4111-8111-111111111111', '55555555-5555-4555-8555-555555555552', 'twin', false, true, false),
  ('dbe8f12b-5577-472e-bd6e-5d749962aade', '66666666-6666-4666-8666-666666666666', '55555555-5555-4555-8555-555555555553', 'any', false, false, false)
ON CONFLICT (group_id, person_id) DO NOTHING;

INSERT INTO group_room_hold (tenant_id, property_id, group_id, room_id)
SELECT 'dbe8f12b-5577-472e-bd6e-5d749962aade', r.property_id, h.group_id, r.id
FROM (VALUES
  ('11111111-1111-4111-8111-111111111111', 'G03'),
  ('11111111-1111-4111-8111-111111111111', '102'),
  ('66666666-6666-4666-8666-666666666666', 'G02')
) AS h(group_id, number)
JOIN room r ON r.property_id = '0e663f34-d4ce-4f40-899c-11f1866047fd' AND r.number = h.number
ON CONFLICT (group_id, room_id) DO NOTHING;

INSERT INTO room_occupancy (tenant_id, room_id, group_id, person_id, occupant_label, on_date, slot)
SELECT 'dbe8f12b-5577-472e-bd6e-5d749962aade', r.id, h.group_id, h.person_id, h.label, hs.on_date, hs.slot
FROM (VALUES
  ('11111111-1111-4111-8111-111111111111'::uuid, '55555555-5555-4555-8555-555555555552'::uuid, '102', 'Test Client 02', '2026-10-12'::date, '2026-10-16'::date, 'PM', 'AM'),
  ('66666666-6666-4666-8666-666666666666'::uuid, '55555555-5555-4555-8555-555555555553'::uuid, 'G02', 'Test Client 03', '2026-11-02'::date, '2026-11-06'::date, 'PM', 'AM')
) AS h(group_id, person_id, number, label, arrival, departure, arrival_slot, departure_slot)
JOIN room r ON r.property_id = '0e663f34-d4ce-4f40-899c-11f1866047fd' AND r.number = h.number
JOIN LATERAL (
  SELECT d::date AS on_date, s AS slot
  FROM generate_series(h.arrival, h.departure, '1 day') AS d
  CROSS JOIN (VALUES ('AM'), ('PM')) AS slots(s)
  WHERE NOT (d::date = h.arrival AND s = 'AM' AND h.arrival_slot = 'PM')
    AND NOT (d::date = h.departure AND s = 'PM' AND h.departure_slot = 'AM')
) hs ON true
ON CONFLICT DO NOTHING;
