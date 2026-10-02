/** Meal covers from a booking's dates, slots, clock times, and headcount. Occupancy, not till sales. */

export type Meal = "breakfast" | "lunch" | "dinner";

export type CoverBooking = {
  id: string;
  name: string;
  arrival: string;
  departure: string;
  arrivalSlot: "AM" | "PM";
  departureSlot: "AM" | "PM";
  arrivalTime?: string | null;
  departureTime?: string | null;
  guests: number;
  mealsFrom?: string | null;
  mealsTo?: string | null;
  notes?: string | null;
  retreatType?: string | null;
  status?: string;
};

export type UnclassifiedMeal = { date: string; meal: Meal; bookingId: string; name: string; reason: string };

const COUNTED = new Set(["PROVISIONAL", "CONFIRMED", "IN_HOUSE", "COMPLETED"]);
/** A departure clock time at or after this is still in the house through breakfast. */
export const BREAKFAST_THROUGH = "09:30";

const saysAfterBreakfast = (b: CoverBooking) =>
  /after breakfast/i.test(`${b.mealsTo ?? ""} ${b.notes ?? ""}`) || String(b.mealsTo ?? "").toUpperCase() === "BREAKFAST";

function timeOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = value.match(/(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
}

function eveningArrival(b: CoverBooking): boolean {
  if (b.arrivalSlot === "PM") return true;
  const t = timeOf(b.arrivalTime);
  return !!t && t >= "17:00";
}

export function coversForBookings(bookings: CoverBooking[], from: string, to: string): {
  days: { date: string; breakfast: number; lunch: number; dinner: number }[];
  unclassified: UnclassifiedMeal[];
} {
  const days = new Map<string, { date: string; breakfast: number; lunch: number; dinner: number }>();
  const unclassified: UnclassifiedMeal[] = [];
  for (const b of bookings) {
    if (!b.arrival || !b.departure || !(b.guests > 0)) continue;
    if (b.status && !COUNTED.has(b.status)) continue;
    for (let date = b.arrival; date <= b.departure && date <= to; date = addDay(date)) {
      if (date < from) continue;
      const first = date === b.arrival;
      const last = date === b.departure;
      const meals = new Set<Meal>(["breakfast", "lunch", "dinner"]);
      if (b.retreatType === "day_retreat" || b.retreatType === "venue_hire") meals.delete("breakfast");
      if (first && eveningArrival(b)) { meals.delete("breakfast"); meals.delete("lunch"); }
      else if (first && b.arrivalSlot === "AM" && !b.mealsFrom) { meals.delete("breakfast"); }
      if (first && b.mealsFrom) {
        const fromMeal = String(b.mealsFrom).toUpperCase();
        if (fromMeal === "NONE") meals.clear();
        if (fromMeal === "LUNCH") meals.delete("breakfast");
        if (fromMeal === "DINNER") { meals.delete("breakfast"); meals.delete("lunch"); }
      }
      if (last && b.departureSlot === "PM") meals.delete("dinner");
      if (last && b.departureSlot === "AM") {
        meals.delete("lunch");
        meals.delete("dinner");
        const clock = timeOf(b.departureTime);
        const through = !!clock && clock >= BREAKFAST_THROUGH;
        if (!(through || saysAfterBreakfast(b))) {
          meals.delete("breakfast");
          unclassified.push({ date, meal: "breakfast", bookingId: b.id, name: b.name, reason: "Morning departure does not say they stayed through breakfast" });
        }
      }
      const day = days.get(date) ?? { date, breakfast: 0, lunch: 0, dinner: 0 };
      for (const meal of meals) day[meal] += b.guests;
      days.set(date, day);
    }
  }
  return { days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)), unclassified };
}

function addDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}
