/**
 * Retreat organiser room assignment.
 * Retreat and group bookings only. People land on the existing room occupancy
 * rows, in rooms the house has held for that booking group.
 */
import { createHash, randomBytes } from "node:crypto";
import { accessOutcome, type AccessCheck } from "../guest/access.ts";

export type RoomHold = {
  id: string;
  number: string;
  capacity: number;
  features: string[];
  bedsSingle: number;
  bedsDouble: number;
  bedsKing: number;
};

export type RoomClient = {
  personId: string;
  name: string;
  preference: string | null;
  shareConsent: boolean;
  needsAccess: boolean;
};

export type Placement = { personId: string; roomId: string; from?: string; to?: string };

export type AssignWarning = { personId: string; roomId: string; message: string };
export type EmptyBed = { roomId: string; number: string; empty: number };

export type PlanResult =
  | { ok: true; warnings: AssignWarning[]; unassigned: { personId: string; name: string }[]; emptyBeds: EmptyBed[] }
  | { ok: false; code: "locked" | "dates" | "person" | "room" | "double" | "capacity" | "share" | "beds"; error: string };

export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** London civil date, YYYY-MM-DD. Lock dates use this, not an instant. */
export function londonToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Locked from arrival minus cutoff days, inclusive. Default cutoff is 7. */
export function lockedOn(arrival: string, cutoffDays: number, today: string): boolean {
  const days = Number.isFinite(cutoffDays) && cutoffDays >= 0 ? Math.floor(cutoffDays) : 7;
  return today >= addDays(arrival, -days);
}

export function datesWithin(arrival: string, departure: string, from: string, to: string): boolean {
  return from >= arrival && to <= departure && from <= to;
}

function mayShare(client: RoomClient): boolean {
  return client.preference === "twin" || client.shareConsent;
}

function twinCapable(room: RoomHold): boolean {
  return room.bedsSingle >= 2 || room.bedsDouble > 0 || room.bedsKing > 0;
}

export function planAssignments(input: {
  rooms: RoomHold[];
  clients: RoomClient[];
  placements: Placement[];
  span: { arrival: string; departure: string };
  locked: boolean;
  staff: boolean;
}): PlanResult {
  if (input.locked && !input.staff) {
    return { ok: false, code: "locked", error: "The house has locked room changes. Ask the house if something needs to move." };
  }
  const rooms = new Map(input.rooms.map(room => [room.id, room]));
  const clients = new Map(input.clients.map(client => [client.personId, client]));
  const seen = new Set<string>();
  const byRoom = new Map<string, RoomClient[]>();

  for (const place of input.placements) {
    const from = place.from ?? input.span.arrival;
    const to = place.to ?? input.span.departure;
    if (!datesWithin(input.span.arrival, input.span.departure, from, to)) {
      return { ok: false, code: "dates", error: "Those dates are outside the retreat." };
    }
    const client = clients.get(place.personId);
    if (!client) return { ok: false, code: "person", error: "That person is not on this retreat." };
    const room = rooms.get(place.roomId);
    if (!room) return { ok: false, code: "room", error: "That room is not held for this retreat." };
    if (seen.has(place.personId)) return { ok: false, code: "double", error: "Each guest can only be in one room." };
    seen.add(place.personId);
    const list = byRoom.get(room.id) ?? [];
    list.push(client);
    byRoom.set(room.id, list);
  }

  for (const [roomId, people] of byRoom) {
    const room = rooms.get(roomId)!;
    if (people.length > room.capacity) {
      return { ok: false, code: "capacity", error: `Room ${room.number} sleeps ${room.capacity}.` };
    }
    if (people.length > 1) {
      if (people.some(person => person.preference === "single")) {
        return { ok: false, code: "share", error: "A single room request cannot share." };
      }
      if (people.some(person => !mayShare(person))) {
        return { ok: false, code: "share", error: "Sharing a room needs consent." };
      }
    }
    if (people.some(person => person.preference === "twin") && !twinCapable(room)) {
      return { ok: false, code: "beds", error: "That room is not set up for a twin." };
    }
  }

  const warnings: AssignWarning[] = [];
  for (const [roomId, people] of byRoom) {
    const room = rooms.get(roomId)!;
    if (room.features.includes("disabled_access")) continue;
    for (const person of people) {
      if (!person.needsAccess) continue;
      warnings.push({
        personId: person.personId,
        roomId: room.id,
        message: `${person.name} asked for step-free access. Room ${room.number} is not marked for disabled access.`,
      });
    }
  }

  const unassigned = input.clients.filter(client => !seen.has(client.personId)).map(client => ({ personId: client.personId, name: client.name }));
  const emptyBeds = input.rooms.flatMap(room => {
    const used = byRoom.get(room.id)?.length ?? 0;
    const empty = room.capacity - used;
    return empty > 0 ? [{ roomId: room.id, number: room.number, empty }] : [];
  });
  return { ok: true, warnings, unassigned, emptyBeds };
}

export function visibleGroups<T extends { groupId: string }>(ownedIds: string[], rows: T[]): T[] {
  const owned = new Set(ownedIds);
  return rows.filter(row => owned.has(row.groupId));
}

export function conflicts(rows: { roomId: string; date: string; slot: string; groupId: string }[]): { roomId: string; date: string; slot: string; groups: string[] }[] {
  const map = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = `${row.roomId}|${row.date}|${row.slot}`;
    const groups = map.get(key) ?? new Set<string>();
    groups.add(row.groupId);
    map.set(key, groups);
  }
  const out: { roomId: string; date: string; slot: string; groups: string[] }[] = [];
  for (const [key, groups] of map) {
    if (groups.size < 2) continue;
    const [roomId, date, slot] = key.split("|");
    out.push({ roomId, date, slot, groups: [...groups] });
  }
  return out;
}

/** 24 random bytes, base64url. Long enough that guessing is not practical. */
export function newOrganiserCode(): string {
  return randomBytes(24).toString("base64url");
}

export function hashOrganiserCode(code: string): string {
  return createHash("sha256").update(code.trim()).digest("hex");
}

/** A revoked code is treated as unknown. The reply must not say that it was revoked. */
export function organiserCodeCheck(input: {
  found: boolean;
  revoked?: boolean;
  hashMatches: boolean;
  expiresAt?: Date | string | null;
  lockedUntil?: Date | string | null;
  now?: Date;
}): AccessCheck {
  if (!input.found || input.revoked || !input.hashMatches) {
    return accessOutcome({ found: false, hashMatches: false, now: input.now });
  }
  return accessOutcome({
    found: true,
    hashMatches: true,
    expiresAt: input.expiresAt,
    lockedUntil: input.lockedUntil,
    now: input.now,
  });
}

export function parseRoomSettings(raw: unknown): { cutoff_days: number; staff_email: string } {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const days = Number(src.cutoff_days);
  const email = typeof src.staff_email === "string" ? src.staff_email.trim() : "";
  return {
    cutoff_days: Number.isFinite(days) && days >= 0 && days <= 60 ? Math.floor(days) : 7,
    staff_email: email,
  };
}

export function assignmentNote(input: { groupName: string; complete: boolean; who: "staff" | "organiser" }): { subject: string; body: string } {
  const done = input.complete ? "completed" : "changed";
  if (input.who === "staff") {
    return {
      subject: `Room list ${done} — ${input.groupName}`,
      body: `The organiser for ${input.groupName} has ${done} the room list. Open the room allocation board to review it.`,
    };
  }
  return {
    subject: `Room list received — ${input.groupName}`,
    body: `Thank you. We have the room list for ${input.groupName}. If anything needs to change, use the same link before the house locks the rooms.`,
  };
}

export function assignmentCsv(rows: { room: string; date: string; group: string; client: string }[]): string {
  const esc = (value: string) => /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const lines = ["room,date,group,client", ...rows.map(row => [row.room, row.date, row.group, row.client].map(esc).join(","))];
  return `${lines.join("\n")}\n`;
}
