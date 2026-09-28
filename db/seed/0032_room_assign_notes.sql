-- Placeholder notes on the example retreat clients. No real guest data.
UPDATE group_attendee SET client_note = 'ground floor please'
  WHERE person_id = '55555555-5555-4555-8555-555555555551' AND client_note = '';
UPDATE group_attendee SET client_note = 'shares with partner', single_occupancy = false
  WHERE person_id = '55555555-5555-4555-8555-555555555552' AND client_note = '';
UPDATE group_attendee SET client_note = 'arriving late'
  WHERE person_id = '55555555-5555-4555-8555-555555555553' AND client_note = '';
