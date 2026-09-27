-- Property public text and the real room count.
-- Migration 0024 runs before this seed creates the property row, so on a brand-new
-- database that UPDATE changes nothing. This seed runs afterwards and is the copy that sticks.
-- 42 rooms: 41 guest rooms plus staff room 104. Rooms 301–307 are not in the inventory.
UPDATE property
SET settings = settings || jsonb_build_object(
  'rooms_total', 42,
  'guest_rooms', 41,
  'kicker', coalesce(settings->>'kicker', 'Retreat Center'),
  'tagline', coalesce(settings->>'tagline', 'Luxury retreat centre'),
  'about', coalesce(settings->>'about',
    'A beautiful grade II-listed luxury retreat centre. Nestled amongst 75 acres of woodlands, meadows and lakes in Lincolnshire — a Grade II listed Elizabethan estate.'),
  'welcome', coalesce(settings->>'welcome',
    'Host your retreats and events with us for an unforgettably meaningful experience. When you arrive, the house is ready. We take care of the rest.'),
  'address', coalesce(settings->>'address', 'Lincoln Rd, Branston, Lincolnshire, LN4 1PD'),
  'legal_entity', coalesce(settings->>'legal_entity', 'The Vedanta Way Ltd'),
  'website', coalesce(settings->>'website', 'https://www.thevedanta.org/')
)
WHERE code = 'VOR';
