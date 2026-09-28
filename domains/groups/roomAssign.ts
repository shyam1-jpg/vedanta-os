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
  /** Another client on this retreat. Wins over a single-occupancy request. */
  shareWithId?: string | null;
  singleOccupancy?: boolean;
};

export type Placement = { personId: string; roomId: string; from?: string; to?: string; source?: "manual" | "auto"; locked?: boolean };

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

function pairedInRoom(person: RoomClient, people: RoomClient[]): boolean {
  const ids = new Set(people.map(item => item.personId));
  if (person.shareWithId && ids.has(person.shareWithId)) return true;
  return people.some(other => other.shareWithId === person.personId);
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
  for (const client of input.clients) {
    if (!client.shareWithId) continue;
    if (client.shareWithId === client.personId || !clients.has(client.shareWithId)) {
      return { ok: false, code: "share", error: `${client.name} asked to share with someone who is not on this retreat.` };
    }
  }
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
      const alone = people.some(person => (person.preference === "single" || person.singleOccupancy) && !pairedInRoom(person, people));
      if (alone) {
        return { ok: false, code: "share", error: "A single room request cannot share." };
      }
      if (people.some(person => !mayShare(person) && !pairedInRoom(person, people))) {
        return { ok: false, code: "share", error: "Sharing a room needs consent." };
      }
    }
    if (people.some(person => person.preference === "twin") && !twinCapable(room)) {
      return { ok: false, code: "beds", error: "That room is not set up for a twin." };
    }
  }

  const roomOf = new Map(input.placements.map(place => [place.personId, place.roomId]));
  for (const client of input.clients) {
    if (!client.shareWithId) continue;
    const mine = roomOf.get(client.personId);
    const theirs = roomOf.get(client.shareWithId);
    if (mine && theirs && mine !== theirs) {
      const other = clients.get(client.shareWithId);
      return { ok: false, code: "share", error: `${client.name} asked to share with ${other?.name ?? "their partner"}, but they are in different rooms.` };
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

export type RoomSettings = { cutoff_days: number; staff_email: string; reminder_days: number[] };

/** Days before the cut-off. Unique, each between 1 and 90. Default 14, 7 and 2. */
export function reminderDays(raw: unknown): number[] {
  const fallback = [14, 7, 2];
  if (!Array.isArray(raw)) return fallback;
  const days = [...new Set(raw.map(item => Number(item)).filter(item => Number.isFinite(item) && item >= 1 && item <= 90).map(item => Math.floor(item)))];
  days.sort((a, b) => b - a);
  return days.length ? days : fallback;
}

export function parseRoomSettings(raw: unknown): RoomSettings {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const days = Number(src.cutoff_days);
  const email = typeof src.staff_email === "string" ? src.staff_email.trim() : "";
  return {
    cutoff_days: Number.isFinite(days) && days >= 0 && days <= 60 ? Math.floor(days) : 7,
    staff_email: email,
    reminder_days: reminderDays(src.reminder_days),
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

export const NOTE_MAX = 200;

export function cleanClientNote(raw: unknown): { ok: true; note: string } | { ok: false; error: string } {
  const note = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (note.length > NOTE_MAX) return { ok: false, error: `A note can be ${NOTE_MAX} characters.` };
  return { ok: true, note };
}

export function heldCapacity(rooms: { capacity: number }[]): number {
  return rooms.reduce((sum, room) => sum + Math.max(0, Math.floor(room.capacity)), 0);
}

export function withinClientLimit(count: number, rooms: { capacity: number }[]): boolean {
  return count <= heldCapacity(rooms);
}

export const CLIENT_LIMIT = "This retreat's rooms are full. Ask the house for more rooms.";

/** A list is ready when nobody is waiting, every client has sent details, and no held bed is empty. */
export function listReady(input: { unassigned: number; missingDetails: number; emptyBeds: number }): boolean {
  return input.unassigned === 0 && input.missingDetails === 0 && input.emptyBeds === 0;
}

export function roomProgress(input: { clients: number; capacity: number; detailsComplete: number; assigned: number }) {
  return {
    clientsAdded: { done: input.clients, total: input.capacity },
    detailsComplete: { done: input.detailsComplete, total: input.clients },
    assigned: { done: input.assigned, total: input.clients },
  };
}

/** Offsets still to send. Empty once the list is ready or the cut-off day has arrived. Catch-up includes every missed offset. */
export function offsetsDue(input: {
  arrival: string;
  cutoffDays: number;
  offsets: number[];
  today: string;
  sent: number[];
  ready: boolean;
}): number[] {
  if (input.ready) return [];
  const cutoffDays = Number.isFinite(input.cutoffDays) && input.cutoffDays >= 0 ? Math.floor(input.cutoffDays) : 7;
  const cutoff = addDays(input.arrival, -cutoffDays);
  if (input.today >= cutoff) return [];
  const sent = new Set(input.sent);
  return [...input.offsets]
    .filter(offset => offset >= 1 && !sent.has(offset) && input.today >= addDays(cutoff, -offset))
    .sort((a, b) => b - a);
}

export function holdChangeWarnings(input: {
  nextRoomIds: string[];
  rooms: { id: string; number: string }[];
  placed: { personId: string; name: string; roomId: string }[];
  otherHolds: { roomId: string; groupName: string }[];
}): string[] {
  const next = new Set(input.nextRoomIds);
  const number = new Map(input.rooms.map(room => [room.id, room.number]));
  const warnings: string[] = [];
  for (const person of input.placed) {
    if (next.has(person.roomId)) continue;
    warnings.push(`${person.name} is in ${number.get(person.roomId) ?? "a room"} which would no longer be held.`);
  }
  for (const hold of input.otherHolds) {
    if (!next.has(hold.roomId)) continue;
    warnings.push(`${number.get(hold.roomId) ?? "A room"} is already held for ${hold.groupName}.`);
  }
  return warnings;
}

/** What an organiser is allowed to see. Health details stay off this object. */
export function organiserClientView(client: {
  personId: string;
  givenName: string;
  familyName: string;
  name: string;
  email: string | null;
  roomPreference: string | null;
  shareConsent: boolean;
  arrivesEarly: boolean;
  note: string;
  shareWithId: string | null;
  shareWithName: string | null;
  singleOccupancy: boolean;
  detailsComplete: boolean;
  roomId: string | null;
  isOrganiser: boolean;
  preferredRoomId: string | null;
}) {
  return {
    person_id: client.personId,
    given_name: client.givenName,
    family_name: client.familyName,
    name: client.name,
    email: client.email,
    room_preference: client.roomPreference,
    share_consent: client.shareConsent,
    arrives_early: client.arrivesEarly,
    note: client.note,
    share_with_id: client.shareWithId,
    share_with_name: client.shareWithName,
    single_occupancy: client.singleOccupancy,
    details_complete: client.detailsComplete,
    room_id: client.roomId,
    is_organiser: client.isOrganiser,
    preferred_room_id: client.preferredRoomId,
  };
}

export type RoomingRow = {
  room: string;
  client: string;
  note: string;
  shareWith: string;
  single: string;
  details: string;
  stepFree?: string;
};

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Live rooming list. The organiser file has no allergen column. Staff may add a step-free flag. */
export function roomingCsv(rows: RoomingRow[], staff = false): string {
  const header = staff
    ? ["room", "client", "note", "share with", "single", "details complete", "step-free"]
    : ["room", "client", "note", "share with", "single", "details complete"];
  const lines = [header.join(",")];
  for (const row of rows) {
    const cells = [row.room, row.client, row.note, row.shareWith, row.single, row.details];
    if (staff) cells.push(row.stepFree ?? "");
    lines.push(cells.map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function escapePdf(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[^\x20-\x7E]/g, "?");
}

function textPdf(lines: string[]): string {
  const source = lines.length ? lines : ["Rooming list"];
  const chunks: string[][] = [];
  for (let i = 0; i < source.length; i += 46) chunks.push(source.slice(i, i + 46));
  const fontId = 3 + chunks.length * 2;
  const objects: string[] = [];
  objects.push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj");
  objects.push(`2 0 obj << /Type /Pages /Count ${chunks.length} /Kids [${chunks.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] >> endobj`);
  chunks.forEach((chunk, i) => {
    const pageId = 3 + i * 2;
    const contentId = pageId + 1;
    const commands = ["BT", "/F1 11 Tf", "50 800 Td", "14 TL"];
    for (const line of chunk) commands.push(`(${escapePdf(line.slice(0, 110))}) Tj`, "T*");
    commands.push("ET");
    const stream = commands.join("\n");
    objects.push(`${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >> endobj`);
    objects.push(`${contentId} 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`);
  });
  objects.push(`${fontId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`);
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(body.length);
    body += `${obj}\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return body;
}

export function roomingPdf(title: string, rows: RoomingRow[]): string {
  const lines = [
    title,
    "Room, client, note, share with, single, details complete",
    ...rows.map(row => `${row.room} | ${row.client} | ${row.note} | ${row.shareWith || "-"} | ${row.single} | ${row.details}`),
  ];
  return textPdf(lines);
}

export function roomReminderNote(input: { groupName: string; cutoff: string; unassigned: number; missingDetails: number; emptyBeds: number }): { subject: string; body: string } {
  return {
    subject: `Room list still open — ${input.groupName}`,
    body: [
      `The room list for ${input.groupName} is still open. Changes close on ${input.cutoff}.`,
      `${input.unassigned} guest${input.unassigned === 1 ? "" : "s"} still need a room.`,
      `${input.missingDetails} guest${input.missingDetails === 1 ? "" : "s"} have not sent their details.`,
      `${input.emptyBeds} held bed${input.emptyBeds === 1 ? "" : "s"} still empty.`,
      "These notes stop once everyone has a room, details are in, and the held beds are full.",
    ].join("\n"),
  };
}

export function roomDigestNote(input: { groups: { name: string; cutoff: string; unassigned: number; missingDetails: number; emptyBeds: number }[] }): { subject: string; body: string } {
  const lines = input.groups.map(group => `${group.name} (closes ${group.cutoff}): ${group.unassigned} without a room, ${group.missingDetails} details missing, ${group.emptyBeds} empty beds.`);
  return {
    subject: "Room lists that are not ready",
    body: ["These retreats still have an open room list.", ...lines].join("\n"),
  };
}

export type AutoRoom = RoomHold & { section: string };
export type AutoClient = RoomClient & { preferredRoomId?: string | null; isOrganiser?: boolean };
export type KeptAssignment = { personId: string; roomId: string; source: "manual" | "auto"; locked: boolean };
export type AutoDecision = { personId: string; roomId: string; reason: string; kept: boolean };

function usedCount(occupancy: Map<string, string[]>, roomId: string): number {
  return occupancy.get(roomId)?.length ?? 0;
}

/**
 * Spread a group across the rooms the house is holding.
 * Manual and locked placements stay put unless reassignAll is set.
 * The same input always produces the same rooms.
 */
export function autoAssign(input: {
  rooms: AutoRoom[];
  clients: AutoClient[];
  kept: KeptAssignment[];
  reassignAll: boolean;
}): { placements: AutoDecision[]; unassigned: { personId: string; name: string; reason: string }[] } {
  const rooms = [...input.rooms].sort((a, b) => a.number.localeCompare(b.number, "en") || a.id.localeCompare(b.id));
  const clients = [...input.clients].sort((a, b) => a.personId.localeCompare(b.personId));
  const byId = new Map(clients.map(client => [client.personId, client]));
  const occupancy = new Map<string, string[]>();
  const placed = new Map<string, AutoDecision>();
  const heldBack = new Map<string, string>();
  const exclusive = new Set<string>();

  const protect = input.reassignAll ? [] : input.kept.filter(row => row.locked || row.source === "manual");
  for (const row of [...protect].sort((a, b) => a.personId.localeCompare(b.personId))) {
    const person = byId.get(row.personId);
    const room = rooms.find(item => item.id === row.roomId);
    if (!person || !room || placed.has(person.personId)) continue;
    occupancy.set(room.id, [...(occupancy.get(room.id) ?? []), person.personId]);
    placed.set(person.personId, {
      personId: person.personId,
      roomId: room.id,
      reason: row.locked ? `${person.name} stays in ${room.number} because that assignment is locked.` : `${person.name} stays in ${room.number} because someone chose that room.`,
      kept: true,
    });
    if ((person.singleOccupancy || person.preference === "single") && !person.shareWithId) exclusive.add(room.id);
  }

  const sectionCounts = () => {
    const counts = new Map<string, number>();
    for (const [roomId, people] of occupancy) {
      if (!people.length) continue;
      const room = rooms.find(item => item.id === roomId);
      if (!room) continue;
      counts.set(room.section, (counts.get(room.section) ?? 0) + people.length);
    }
    return counts;
  };

  const choose = (candidates: AutoRoom[], person: AutoClient, mode: "fill" | "smallest"): AutoRoom | null => {
    const open = candidates.filter(room => room.capacity - usedCount(occupancy, room.id) > 0 && !exclusive.has(room.id));
    if (!open.length) return null;
    if (person.isOrganiser && person.preferredRoomId) {
      const pref = open.find(room => room.id === person.preferredRoomId);
      if (pref) return pref;
    }
    const sections = sectionCounts();
    return [...open].sort((a, b) => {
      if (mode === "smallest" && a.capacity !== b.capacity) return a.capacity - b.capacity;
      if (mode === "fill") {
        const fill = (usedCount(occupancy, b.id) > 0 ? 1 : 0) - (usedCount(occupancy, a.id) > 0 ? 1 : 0);
        if (fill) return fill;
      }
      const cluster = (sections.get(b.section) ?? 0) - (sections.get(a.section) ?? 0);
      if (cluster) return cluster;
      const balance = usedCount(occupancy, a.id) - usedCount(occupancy, b.id);
      if (balance) return balance;
      return a.number.localeCompare(b.number, "en") || a.id.localeCompare(b.id);
    })[0];
  };

  const place = (person: AutoClient, room: AutoRoom, reason: string) => {
    occupancy.set(room.id, [...(occupancy.get(room.id) ?? []), person.personId]);
    placed.set(person.personId, { personId: person.personId, roomId: room.id, reason, kept: false });
  };

  const accessRooms = rooms.filter(room => room.features.includes("disabled_access"));
  for (const person of clients) {
    if (!person.needsAccess || placed.has(person.personId) || heldBack.has(person.personId)) continue;
    let candidates = accessRooms;
    const partnerId = person.shareWithId && byId.has(person.shareWithId) ? person.shareWithId : null;
    if (partnerId && !placed.has(partnerId)) {
      const pairRooms = candidates.filter(room => room.capacity - usedCount(occupancy, room.id) >= 2);
      if (pairRooms.length) candidates = pairRooms;
    }
    if ((person.singleOccupancy || person.preference === "single") && !person.shareWithId) {
      const empty = candidates.filter(room => usedCount(occupancy, room.id) === 0);
      if (!empty.length) continue;
      candidates = empty;
    }
    const room = choose(candidates, person, "fill");
    if (!room) continue;
    place(person, room, `${person.name} needs step-free access, so they go in ${room.number}.`);
  }

  for (const asker of clients) {
    if (!asker.shareWithId || heldBack.has(asker.personId)) continue;
    const target = byId.get(asker.shareWithId);
    if (!target) {
      if (!placed.has(asker.personId)) heldBack.set(asker.personId, `${asker.name} asked to share with someone who is not on this retreat.`);
      continue;
    }
    if (placed.has(asker.personId) && placed.has(target.personId)) continue;
    const aside = asker.singleOccupancy || asker.preference === "single" || target.singleOccupancy || target.preference === "single"
      ? " The single-occupancy request was set aside so they can share."
      : "";
    const needsAccess = asker.needsAccess || target.needsAccess;
    const anchor = placed.has(target.personId) ? target : placed.has(asker.personId) ? asker : null;
    const joiner = anchor === target ? asker : anchor === asker ? target : null;
    if (anchor && joiner) {
      const room = rooms.find(item => item.id === placed.get(anchor.personId)?.roomId);
      if (!room || heldBack.has(joiner.personId) || placed.has(joiner.personId)) continue;
      const free = room.capacity - usedCount(occupancy, room.id);
      if (needsAccess && !room.features.includes("disabled_access")) {
        heldBack.set(joiner.personId, `${joiner.name} asked to share with ${anchor.name}, but ${room.number} is not step-free.`);
        continue;
      }
      if (free < 1 || exclusive.has(room.id)) {
        heldBack.set(joiner.personId, `${joiner.name} asked to share with ${anchor.name}, but ${room.number} has no free bed.`);
        continue;
      }
      place(joiner, room, `${joiner.name} shares with ${anchor.name} in ${room.number}.${aside}`);
      continue;
    }
    let candidates = rooms.filter(room => room.capacity - usedCount(occupancy, room.id) >= 2 && !exclusive.has(room.id));
    if (needsAccess) candidates = candidates.filter(room => room.features.includes("disabled_access"));
    const organiser = [asker, target].find(person => person.isOrganiser && person.preferredRoomId);
    let room = organiser ? candidates.find(item => item.id === organiser.preferredRoomId) ?? null : null;
    if (!room) room = choose(candidates, asker, "fill");
    if (!room) {
      const why = `${asker.name} asked to share with ${target.name}, but no room has two free beds${needsAccess ? " with step-free access" : ""}.`;
      heldBack.set(asker.personId, why);
      if (target.shareWithId === asker.personId) heldBack.set(target.personId, why);
      continue;
    }
    const targetAside = target.singleOccupancy || target.preference === "single" ? " The single-occupancy request was set aside so they can share." : "";
    place(target, room, `${target.name} shares with ${asker.name} in ${room.number}.${targetAside}`);
    place(asker, room, `${asker.name} shares with ${target.name} in ${room.number}.${aside}`);
  }

  for (const person of clients) {
    if (placed.has(person.personId) || heldBack.has(person.personId) || person.shareWithId) continue;
    if (!person.singleOccupancy && person.preference !== "single") continue;
    let candidates = rooms.filter(room => usedCount(occupancy, room.id) === 0);
    if (person.needsAccess) {
      const access = candidates.filter(room => room.features.includes("disabled_access"));
      if (access.length) candidates = access;
    }
    const room = choose(candidates, person, "smallest");
    if (!room) {
      heldBack.set(person.personId, `${person.name} asked for a room to themselves, but no empty room is free.`);
      continue;
    }
    place(person, room, `${person.name} asked for a room to themselves, so they have ${room.number}.`);
    exclusive.add(room.id);
  }

  const consenting = (person: AutoClient) => person.preference === "twin" || person.shareConsent || !!person.shareWithId;
  for (const person of clients) {
    if (placed.has(person.personId) || heldBack.has(person.personId) || !consenting(person)) continue;
    let candidates = rooms.filter(room => twinCapable(room));
    if (person.needsAccess) {
      const access = candidates.filter(room => room.features.includes("disabled_access"));
      if (access.length) candidates = access;
    }
    const room = choose(candidates, person, "fill");
    if (!room) continue;
    const accessNote = person.needsAccess && !room.features.includes("disabled_access") ? " No step-free room was free." : "";
    place(person, room, `${person.name} shares ${room.number}, which can take more than one guest.${accessNote}`);
  }

  for (const person of clients) {
    if (placed.has(person.personId) || heldBack.has(person.personId)) continue;
    let candidates = rooms.filter(room => consenting(person) || usedCount(occupancy, room.id) === 0);
    if ((person.singleOccupancy || person.preference === "single") && !person.shareWithId) {
      candidates = candidates.filter(room => usedCount(occupancy, room.id) === 0);
    }
    if (person.needsAccess) {
      const access = candidates.filter(room => room.features.includes("disabled_access"));
      if (access.length) candidates = access;
    }
    const room = choose(candidates, person, "fill");
    if (!room) {
      heldBack.set(person.personId, `${person.name} could not be placed without breaking a room rule.`);
      continue;
    }
    const accessNote = person.needsAccess && !room.features.includes("disabled_access") ? " No step-free room was free." : "";
    place(person, room, `${person.name} goes in ${room.number}.${accessNote}`);
  }

  return {
    placements: clients.filter(person => placed.has(person.personId)).map(person => placed.get(person.personId)!),
    unassigned: clients.filter(person => !placed.has(person.personId)).map(person => ({
      personId: person.personId,
      name: person.name,
      reason: heldBack.get(person.personId) ?? `${person.name} could not be placed.`,
    })),
  };
}
