/** Which bookings a list should show.
 * Dates are calendar dates in Europe/London. Nothing here deletes or changes a booking.
 */

export type BookingListScope = "upcoming" | "past" | "all";

export type BookingScopeInput = "omit" | "invalid" | BookingListScope;

export function londonToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Omitted scope stays "all" so existing callers of the list keep every booking. */
export function parseBookingListScope(raw: unknown): BookingScopeInput {
  if (raw == null) return "omit";
  const s = String(raw).trim().toLowerCase();
  if (!s) return "omit";
  if (s === "upcoming" || s === "past" || s === "all") return s;
  return "invalid";
}

export function bookingMatchesScope(
  g: { departure: string; status: string },
  scope: BookingListScope,
  today: string,
): boolean {
  if (scope === "all") return true;
  const cancelled = g.status === "CANCELLED";
  if (scope === "past") return g.departure < today || cancelled;
  return g.departure >= today && !cancelled;
}

/** $1 is the Europe/London date (YYYY-MM-DD). "all" and "omit" add no date predicate. */
export function bookingScopeFilterSql(scope: BookingScopeInput): string {
  if (scope === "omit" || scope === "all" || scope === "invalid") return "true";
  if (scope === "upcoming") return "departure_date >= $1::date AND status <> 'CANCELLED'";
  return "(departure_date < $1::date OR status = 'CANCELLED')";
}

export function bookingScopeOrderSql(scope: BookingScopeInput): string {
  if (scope === "past") return "departure_date desc, arrival_date desc, arrival_slot desc";
  return "arrival_date, arrival_slot";
}

export function sortBookings<T extends { arrival: string; departure: string; status?: string }>(
  rows: readonly T[],
  scope: BookingListScope,
): T[] {
  const copy = [...rows];
  if (scope === "past") {
    copy.sort((a, b) => b.departure.localeCompare(a.departure) || b.arrival.localeCompare(a.arrival));
    return copy;
  }
  copy.sort((a, b) => a.arrival.localeCompare(b.arrival) || a.departure.localeCompare(b.departure));
  return copy;
}
