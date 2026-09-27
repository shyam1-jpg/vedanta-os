-- Synthetic bookings for local development and trials.
-- These people are fictional. Emails use example.invalid. Phone numbers are Ofcom drama numbers.
-- Do not replace this file with a booking-spreadsheet export.

INSERT INTO person (id, tenant_id, given_name, family_name, email, phone, organisation, notes)
VALUES
  ('22222222-2222-4222-8222-222222222222', 'dbe8f12b-5577-472e-bd6e-5d749962aade', 'Alex', 'Example', 'alex.example@example.invalid', '07700900111', 'Example Retreat Circle', 'Synthetic guest note. Not a real person.'),
  ('33333333-3333-4333-8333-333333333333', 'dbe8f12b-5577-472e-bd6e-5d749962aade', 'Sam', 'Sample', 'sam.sample@example.invalid', '07700900222', 'Example Retreat Circle', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO booking_group (
  id, tenant_id, property_id, name, organisation, contact_email, contact_phone,
  arrival_date, arrival_slot, departure_date, departure_slot, retreat_type, use_basis,
  expected_guests, expected_rooms, status, booking_form_status, notes, dietary_notes, colour, source, version
) VALUES (
  '11111111-1111-4111-8111-111111111111',
  'dbe8f12b-5577-472e-bd6e-5d749962aade',
  '0e663f34-d4ce-4f40-899c-11f1866047fd',
  'Example Autumn Retreat',
  'Example Retreat Circle',
  'organiser@example.invalid',
  '07700900123',
  '2026-10-12', 'PM', '2026-10-16', 'AM',
  'residential', 'SHARED', 8, 4, 'CONFIRMED', 'COMPLETE',
  'Synthetic sample for development. Not a real booking.',
  'One guest is vegan and has a tree-nut allergy. Everyone else is the house default.',
  '#1F3A32', 'SYNTHETIC', 1
) ON CONFLICT (id) DO NOTHING;

INSERT INTO diet_profile (tenant_id, person_id, diet, allergens, severity, notes)
VALUES
  ('dbe8f12b-5577-472e-bd6e-5d749962aade', '22222222-2222-4222-8222-222222222222', '{vegan}', '{nuts}', 'ALLERGY', 'Synthetic allergen record. Carries an epinephrine pen in the story only.'),
  ('dbe8f12b-5577-472e-bd6e-5d749962aade', '33333333-3333-4333-8333-333333333333', '{vegetarian,no_onion_garlic}', '{}', NULL, NULL)
ON CONFLICT (person_id) DO NOTHING;

INSERT INTO room_occupancy (tenant_id, room_id, group_id, person_id, occupant_label, on_date, slot)
SELECT 'dbe8f12b-5577-472e-bd6e-5d749962aade', r.id,
  '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
  'Alex Example', d::date, s
FROM room r
CROSS JOIN (VALUES ('2026-10-13'), ('2026-10-14')) AS days(d)
CROSS JOIN (VALUES ('AM'), ('PM')) AS slots(s)
WHERE r.property_id = '0e663f34-d4ce-4f40-899c-11f1866047fd' AND r.number = 'G01'
ON CONFLICT DO NOTHING;

INSERT INTO guest_enquiry (
  id, tenant_id, property_id, name, email, people, arrival_date, departure_date, status,
  notes, dietary_notes, accessibility_notes, travel_notes
)
SELECT
  '44444444-4444-4444-8444-444444444444',
  t.id, p.id,
  'Jordan Placeholder', 'jordan.placeholder@example.invalid', 2,
  '2026-11-02', '2026-11-05', 'ENQUIRY',
  'Synthetic enquiry. Not a real guest.',
  'Dairy-free',
  'Ground-floor room if one is free',
  'Train to Lincoln, then a taxi'
FROM tenant t
JOIN property p ON p.tenant_id = t.id AND p.code = 'VOR'
ON CONFLICT (id) DO NOTHING;
