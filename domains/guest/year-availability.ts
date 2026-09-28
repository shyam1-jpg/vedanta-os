/**
 * Public year availability.
 * Callers pass room, occupancy and programme facts. The result is an allow-listed
 * document: status and counts only. Person columns on the input are ignored.
 */
import { typeName } from "./availability.ts";
import { isPublicProgrammeName, programmeKind, publicProgrammeName } from "./programmes.ts";

export const TIMEZONE = "Europe/London" as const;
export const YEAR_AHEAD = 2;
/** More rooms than this are shown as types, not one row per room. The house has 41. */
export const GROUP_ROOMS_ABOVE = 8;
/** Public GET. Browsers keep a short copy; Cloudflare honours s-maxage. */
export const PUBLIC_AVAILABILITY_CACHE = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";

export type DayStatus = "available" | "unavailable" | "blocked";
export type SpaceStatus = "available" | "limited" | "full";
export type DisplayKind = "available" | "unavailable" | "past";

export type RoomFact = {
  number: string;
  type: string;
  typeName: string | null;
  sleeps: number;
  accessible: boolean;
  /** OUT_OF_SERVICE or OUT_OF_ORDER: unsellable every night, same rule as freeRooms. */
  blocked: boolean;
};

/** A night that is taken. `held` means a group or programme allocation; otherwise a booking. */
export type NightHold = {
  room: string;
  night: string;
  held: boolean;
};

export type ProgrammeFact = {
  id: string;
  name: string;
  retreat_type: string;
  arrival: string;
  departure: string;
  expected_guests: number | null;
  attendees: number;
  enquiry_people: number;
};

export type PublicTypeYear = {
  code: string;
  name: string;
  sleeps: number;
  accessible: boolean;
  total: number;
  /** a = available, u = booked or held, b = maintenance / out of service. One char per day from 1 Jan. */
  status: string;
  free: number[];
};

export type PublicRoomYear = {
  number: string;
  code: string;
  name: string;
  sleeps: number;
  accessible: boolean;
  status: string;
  free: number[];
};

export type PublicRetreat = {
  id: string;
  name: string;
  kind: string;
  arrival: string;
  departure: string;
  capacity: number | null;
  booked: number;
  spaces: SpaceStatus;
};

export type PublicYearAvailability = {
  year: number;
  timezone: typeof TIMEZONE;
  view: "types" | "rooms";
  types: PublicTypeYear[];
  rooms?: PublicRoomYear[];
  retreats: PublicRetreat[];
};

const PERSON_KEYS = new Set([
  "email", "guest_email", "guest_name", "guest", "organiser", "organizer",
  "organiser_name", "organizer_name", "organisation", "organization",
  "notes", "note", "dietary_notes", "accessibility_notes", "sheet_text",
  "occupant", "occupant_label", "phone", "contact_email", "contact_phone", "contact",
  "booking_ref", "external_ref", "reference", "person_id", "person", "host",
  "display_name", "given_name", "family_name", "access_code", "attendee", "attendees",
]);

/** Calendar date in Europe/London. Do not use toISOString(): that is UTC and shifts a day in BST. */
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
  if (year.length !== 4 || month.length !== 2 || day.length !== 2) {
    throw new Error("Could not read the London date");
  }
  return `${year}-${month}-${day}`;
}

export function allowedYears(todayISO: string): { min: number; max: number } {
  const year = Number(todayISO.slice(0, 4));
  return { min: year, max: year + YEAR_AHEAD };
}

export function datesInYear(year: number): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(year, 0, 1));
  while (d.getUTCFullYear() === year) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
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
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
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

/** Limited once a quarter or less of the places remain. Unknown capacity stays open. */
export function retreatSpaces(capacity: number | null, booked: number): SpaceStatus {
  if (capacity == null || capacity <= 0) return "available";
  if (booked >= capacity) return "full";
  if ((capacity - booked) / capacity <= 0.25) return "limited";
  return "available";
}

export function allowPublicRead(
  hits: Map<string, { n: number; t: number }>,
  key: string,
  now = Date.now(),
  limit = 30,
  windowMs = 60_000,
): boolean {
  const cur = hits.get(key);
  if (!cur || now - cur.t >= windowMs) {
    hits.set(key, { n: 1, t: now });
    return true;
  }
  cur.n += 1;
  return cur.n <= limit;
}

const CODE: Record<DayStatus, string> = { available: "a", unavailable: "u", blocked: "b" };

function roomNightStatus(room: RoomFact, date: string, holds: Set<string>): DayStatus {
  if (room.blocked) return "blocked";
  if (holds.has(`${room.number}|${date}`)) return "unavailable";
  return "available";
}

function rollup(members: RoomFact[], date: string, holds: Set<string>): { status: DayStatus; free: number } {
  let free = 0;
  let occupied = 0;
  let blocked = 0;
  for (const room of members) {
    const status = roomNightStatus(room, date, holds);
    if (status === "available") free += 1;
    else if (status === "blocked") blocked += 1;
    else occupied += 1;
  }
  if (free > 0) return { status: "available", free };
  if (occupied === 0 && blocked > 0) return { status: "blocked", free: 0 };
  return { status: "unavailable", free: 0 };
}

function encode(dates: string[], members: RoomFact[], holds: Set<string>): { status: string; free: number[] } {
  let status = "";
  const free: number[] = [];
  for (const date of dates) {
    const day = rollup(members, date, holds);
    status += CODE[day.status];
    free.push(day.free);
  }
  return { status, free };
}

function typeLabel(code: string, stored: string | null, accessible: boolean): string {
  const base = typeName(code, stored);
  if (!accessible) return base;
  return `Accessible ${base.charAt(0).toLowerCase()}${base.slice(1)}`;
}

export function buildPublicAvailability(input: {
  year: number;
  rooms: RoomFact[];
  nights: NightHold[];
  programmes: ProgrammeFact[];
}): PublicYearAvailability {
  const dates = datesInYear(input.year);
  const start = dates[0] ?? `${input.year}-01-01`;
  const end = dates[dates.length - 1] ?? `${input.year}-12-31`;
  const holds = new Set<string>();
  for (const night of input.nights) {
    if (night.night < start || night.night > end) continue;
    holds.add(`${night.room}|${night.night}`);
  }

  const groups = new Map<string, RoomFact[]>();
  for (const room of input.rooms) {
    const key = `${room.type}|${room.accessible ? "a" : "n"}`;
    const list = groups.get(key) ?? [];
    list.push(room);
    groups.set(key, list);
  }

  const types: PublicTypeYear[] = [...groups.entries()].map(([, members]) => {
    const first = members[0];
    const encoded = encode(dates, members, holds);
    return {
      code: first.type,
      name: typeLabel(first.type, first.typeName, first.accessible),
      sleeps: Math.max(...members.map(r => Number(r.sleeps) || 1)),
      accessible: first.accessible,
      total: members.length,
      status: encoded.status,
      free: encoded.free,
    };
  }).sort((a, b) => a.code.localeCompare(b.code) || Number(a.accessible) - Number(b.accessible) || a.name.localeCompare(b.name));

  const grouped = input.rooms.length > GROUP_ROOMS_ABOVE;
  const body: PublicYearAvailability = {
    year: input.year,
    timezone: TIMEZONE,
    view: grouped ? "types" : "rooms",
    types,
    retreats: retreatsForYear(input.year, input.programmes),
  };
  if (!grouped) {
    body.rooms = [...input.rooms]
      .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
      .map(room => {
        const encoded = encode(dates, [room], holds);
        return {
          number: room.number,
          code: room.type,
          name: typeLabel(room.type, room.typeName, room.accessible),
          sleeps: Number(room.sleeps) || 1,
          accessible: room.accessible,
          status: encoded.status,
          free: encoded.free,
        };
      });
  }
  return body;
}

export function retreatsForYear(year: number, programmes: ProgrammeFact[]): PublicRetreat[] {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const out: PublicRetreat[] = [];
  for (const programme of programmes) {
    if (programme.retreat_type !== "residential" && programme.retreat_type !== "day_retreat") continue;
    if (!programme.arrival || !programme.departure) continue;
    if (programme.departure < start || programme.arrival > end) continue;
    if (!isPublicProgrammeName(programme.name)) continue;
    const name = publicProgrammeName(programme.name, programmeKind(programme.retreat_type));
    if (!name || !isPublicProgrammeName(name)) continue;
    const capacity = programme.expected_guests == null ? null : Number(programme.expected_guests);
    const booked = Math.max(0, Number(programme.attendees) || 0) + Math.max(0, Number(programme.enquiry_people) || 0);
    out.push({
      id: programme.id,
      name,
      kind: programmeKind(programme.retreat_type),
      arrival: programme.arrival,
      departure: programme.departure,
      capacity: capacity != null && Number.isFinite(capacity) ? capacity : null,
      booked,
      spaces: retreatSpaces(capacity != null && Number.isFinite(capacity) ? capacity : null, booked),
    });
  }
  return out.sort((a, b) => a.arrival.localeCompare(b.arrival) || a.name.localeCompare(b.name));
}

/** Paths of person-shaped keys, plus any string that looks like an email address. */
export function personFieldPaths(value: unknown): string[] {
  const bad: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        if (PERSON_KEYS.has(key.toLowerCase())) bad.push(`${path}.${key}`);
        walk(child, `${path}.${key}`);
      }
      return;
    }
    if (typeof node === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(node)) bad.push(path);
  };
  walk(value, "$");
  return bad;
}
