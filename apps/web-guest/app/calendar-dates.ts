/**
 * UK calendar dates for the guest book.
 * Kept in step with domains/guest/year-availability.ts — that module is the one the API tests.
 * This copy exists so the static guest site does not import server TypeScript by file extension.
 */
export const TIMEZONE = "Europe/London";
export const YEAR_AHEAD = 2;

export type DayStatus = "available" | "unavailable" | "blocked";
export type DisplayKind = "available" | "unavailable" | "past";

export type PublicRetreat = {
  id: string;
  name: string;
  kind: string;
  arrival: string;
  departure: string;
  capacity: number | null;
  booked: number;
  spaces: "available" | "limited" | "full";
};

export type YearRow = {
  key: string;
  title: string;
  meta: string;
  total: number;
  status: string;
  free: number[];
};

export type PublicYearAvailability = {
  year: number;
  timezone: "Europe/London";
  view: "types" | "rooms";
  types: { code: string; name: string; sleeps: number; accessible: boolean; total: number; status: string; free: number[] }[];
  rooms?: { number: string; code: string; name: string; sleeps: number; accessible: boolean; status: string; free: number[] }[];
  retreats: PublicRetreat[];
};

export function londonTodayISO(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  if (year.length !== 4 || month.length !== 2 || day.length !== 2) throw new Error("Could not read the London date");
  return `${year}-${month}-${day}`;
}

export function allowedYears(todayISO: string): { min: number; max: number } {
  const year = Number(todayISO.slice(0, 4));
  return { min: year, max: year + YEAR_AHEAD };
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function dayIndex(date: string, year: number): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(year, 0, 1)) / 86_400_000);
}

export function monthWeeks(year: number, monthIndex: number): (string | null)[][] {
  const firstDow = (new Date(Date.UTC(year, monthIndex, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: days }, (_, i) => {
      const day = String(i + 1).padStart(2, "0");
      const month = String(monthIndex + 1).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }),
  ];
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function formatDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function dayAria(date: string, kind: DisplayKind, detail?: string): string {
  const base = `${formatDay(date)}, ${kind}`;
  return detail ? `${base}, ${detail}` : base;
}

export function displayKind(date: string, status: DayStatus, today: string | null): DisplayKind {
  if (today && date < today) return "past";
  return status === "available" ? "available" : "unavailable";
}
