/** Calendar dates belong to the house, not the visitor's device timezone. */
export function houseToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const value = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === date;
}

export function validateStay(arrival: string, departure: string, people: string, today: string): string | null {
  if (!validDate(arrival) || !validDate(departure)) return "Choose your arrival and departure dates.";
  if (arrival < today) return "Your arrival date cannot be in the past.";
  if (departure <= arrival) return "Choose a departure after your arrival date.";
  if (!/^\d+$/.test(people) || Number(people) < 1 || Number(people) > 41) return "Enter a whole number of guests between 1 and 41.";
  return null;
}

/** Monday-first alignment; UTC prevents a date moving to the previous day. */
export function calendarOffset(date: string): number {
  return (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
}

export function calendarMonths<T extends { date: string }>(days: T[]): { key: string; title: string; days: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const day of days) {
    const key = day.date.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), day]);
  }
  return [...groups].map(([key, items]) => ({ key, days: items, title: new Date(`${key}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) }));
}
