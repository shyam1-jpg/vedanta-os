/** Client copy of domains/groups/booking-scope.ts.
 * The bookings screen asks the API for ?scope=. These helpers cover the
 * confirmed-ahead count, the default selection, and a fallback if that request fails.
 */

export type BookingListScope = "upcoming" | "past" | "all";

export function londonToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
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

export function sortBookings<T extends { arrival: string; departure: string }>(
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
