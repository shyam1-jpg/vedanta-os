/** Arrival registration is not room check-in, payment clearance or key release. */
export type ArrivalStay = {
  status: string; booking_status: string | null; arrival: string; departure: string;
};
export function arrivalPolicy(stay: ArrivalStay, today: string, detailsConfirmed: boolean) {
  const confirmedBooking = stay.status === 'CONVERTED' && ['CONFIRMED', 'IN_HOUSE'].includes(stay.booking_status ?? '');
  const upcoming = confirmedBooking && today <= stay.departure;
  const daysUntil = (Date.parse(stay.arrival + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000;
  const canConfirm = upcoming && daysUntil <= 14;
  // Day retreats may report arrival on their only day. Overnight stays stop on departure day.
  const arrivalDay = today >= stay.arrival && (today < stay.departure || stay.arrival === stay.departure && today === stay.arrival);
  const canArrive = canConfirm && arrivalDay && detailsConfirmed;
  const reason = !confirmedBooking ? 'The house must confirm your booking before pre-arrival check-in opens.'
    : today > stay.departure || today === stay.departure && stay.arrival !== stay.departure ? 'This stay has reached its departure date.'
    : daysUntil > 14 ? 'Pre-arrival check-in opens 14 days before your stay.'
    : !detailsConfirmed ? 'Review your saved stay details, then confirm they are up to date.'
    : today < stay.arrival ? 'You can tell reception you have arrived from your arrival date.'
    : 'When you reach the house, tell reception you have arrived.';
  return { can_confirm: canConfirm && (today < stay.departure || stay.arrival === stay.departure), can_arrive: canArrive, reason };
}
