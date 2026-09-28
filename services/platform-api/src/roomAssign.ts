/**
 * Retreat organiser room assignment.
 * Organiser routes require a real session: a form-token exchange, a verified guest
 * session whose email matches the organiser, or a per-group access code.
 * A Bearer prefix is not a session. The token must match a stored row exactly.
 * People are written onto room_occupancy with person_id so the kitchen and the
 * arrivals list see them. This stays off the public booking gate.
 */
import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { pool, tx, type Q } from "./db.ts";
import { allow, problem, requireActor, type Actor } from "./auth.ts";
import { audit } from "./groups.ts";
import { openList, openText, sealList, sealText } from "./fieldCrypto.ts";
import { sendEmail } from "./email.ts";
import { accessOutcome, issueExpiry, nextFailedAttempts, publicLoginDetail } from "../../../domains/guest/access.ts";
import { UK_ALLERGENS } from "../../../domains/guest/diet.ts";
import { halfDays } from "../../../domains/groups/half-days.ts";
import {
  addDays,
  assignmentCsv,
  assignmentNote,
  conflicts,
  hashOrganiserCode,
  lockedOn,
  londonToday,
  newOrganiserCode,
  organiserCodeCheck,
  parseRoomSettings,
  planAssignments,
  type AssignWarning,
  type Placement,
  type RoomClient,
  type RoomHold,
} from "../../../domains/groups/roomAssign.ts";

const ALLERGENS: readonly string[] = UK_ALLERGENS;
const SEVERITY = ["PREFERENCE", "INTOLERANCE", "ALLERGY", "ANAPHYLAXIS"];
const NOT_YOURS = "That retreat is not on your list";

const hits = new Map<string, { n: number; t: number }>();
function rateOk(key: string): boolean {
  const now = Date.now();
  const cur = hits.get(key);
  if (!cur || now - cur.t > 60_000) { hits.set(key, { n: 1, t: now }); return true; }
  cur.n += 1;
  return cur.n <= 8;
}

type OrgSession = { tenantId: string; propertyId: string; groupIds: string[]; kind: string };
type AttendeeIn = {
  person_id?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  phone?: string;
  diet?: string[];
  allergens?: string[];
  severity?: string;
  diet_notes?: string;
  room_preference?: string;
  arrives_early?: boolean;
  share_consent?: boolean;
  needs_access?: boolean;
};

async function loadSettings(propertyId: string) {
  const row = (await pool.query(`select settings->'rooms' rooms from property where id=$1`, [propertyId])).rows[0];
  return parseRoomSettings(row?.rooms ?? {});
}

async function requireOrganiser(req: FastifyRequest, reply: FastifyReply): Promise<OrgSession | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    reply.code(401).send(problem(401, "unauthenticated", "Sign in to continue"));
    return null;
  }
  const token = auth.slice(7);
  const row = (await pool.query(
    `select tenant_id, property_id, group_ids, kind from organiser_session where token=$1 and expires_at > now()`,
    [token],
  )).rows[0];
  if (!row) {
    reply.code(401).send(problem(401, "unauthenticated", "Sign in to continue"));
    return null;
  }
  return { tenantId: row.tenant_id, propertyId: row.property_id, groupIds: row.group_ids, kind: row.kind };
}

async function issueSession(tenantId: string, propertyId: string, groupIds: string[], kind: "code" | "form" | "guest") {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + 12 * 60 * 60 * 1000);
  await pool.query(
    `insert into organiser_session (token, tenant_id, property_id, group_ids, expires_at, kind) values ($1,$2,$3,$4,$5,$6)`,
    [token, tenantId, propertyId, groupIds, expires, kind],
  );
  return { token, expires_at: expires.toISOString(), groups: groupIds };
}

async function auditOrg(c: Q | typeof pool, tenantId: string, propertyId: string, groupId: string, action: string, payload: object) {
  await c.query(
    `insert into audit_event (tenant_id, property_id, actor_type, entity_type, entity_id, action, payload) values ($1,$2,'INTEGRATION','booking_group',$3,$4,$5)`,
    [tenantId, propertyId, groupId, action, payload],
  );
}

async function notifyAssignment(ctx: { tenantId: string; propertyId: string; userId?: string | null }, group: { id: string; name: string; contact_email: string | null }, complete: boolean) {
  const settings = await loadSettings(ctx.propertyId);
  const staff = assignmentNote({ groupName: group.name, complete, who: "staff" });
  const organiser = assignmentNote({ groupName: group.name, complete, who: "organiser" });
  if (settings.staff_email.includes("@")) {
    await sendEmail(ctx, { to: settings.staff_email, subject: staff.subject, body: staff.body, kind: "organiser_rooms", related_type: "booking_group", related_id: group.id });
  }
  if (group.contact_email?.includes("@")) {
    await sendEmail(ctx, { to: group.contact_email, subject: organiser.subject, body: organiser.body, kind: "organiser_rooms", related_type: "booking_group", related_id: group.id });
  }
}

function shapeClient(row: Record<string, unknown>): RoomClient & { given_name: string; family_name: string } {
  const given = String(row.given_name ?? "");
  const family = String(row.family_name ?? "");
  return {
    personId: String(row.person_id),
    name: `${given} ${family}`.trim(),
    given_name: given,
    family_name: family,
    preference: (row.room_preference as string | null) ?? null,
    shareConsent: !!row.share_consent,
    needsAccess: !!row.needs_access,
  };
}

async function groupBundle(c: Q | typeof pool, propertyId: string, groupId: string, owned: string[] | null) {
  const g = (await c.query(
    `select id, tenant_id, property_id, name, organisation, contact_email, status, colour,
      arrival_date::text arrival, arrival_slot, departure_date::text departure, departure_slot
     from booking_group
     where id=$1 and property_id=$2 and ($3::uuid[] is null or id = any($3::uuid[]))`,
    [groupId, propertyId, owned],
  )).rows[0];
  return g;
}

async function writeAssignments(c: Q, ctx: { tenantId: string; propertyId: string; owned: string[] | null; staff: boolean }, groupId: string, placements: Placement[]) {
  const g = await groupBundle(c, ctx.propertyId, groupId, ctx.owned);
  if (!g) return { ok: false as const, status: 404, body: problem(404, "not_found", ctx.owned ? NOT_YOURS : "No such booking") };
  if (g.status === "CANCELLED") return { ok: false as const, status: 410, body: problem(410, "gone", "This booking has been cancelled") };
  if (!g.arrival || !g.departure) return { ok: false as const, status: 422, body: problem(422, "validation", "This booking has no dates") };
  const settings = await loadSettings(ctx.propertyId);
  const roomRows = (await c.query(
    `select r.id, r.number, r.max_capacity, r.features, r.beds_single, r.beds_double, r.beds_king
     from group_room_hold h join room r on r.id=h.room_id where h.group_id=$1`,
    [groupId],
  )).rows;
  const rooms: RoomHold[] = roomRows.map(row => ({
    id: row.id,
    number: row.number,
    capacity: Number(row.max_capacity ?? 0),
    features: row.features ?? [],
    bedsSingle: Number(row.beds_single ?? 0),
    bedsDouble: Number(row.beds_double ?? 0),
    bedsKing: Number(row.beds_king ?? 0),
  }));
  const people = (await c.query(
    `select p.id person_id, p.given_name, p.family_name, ga.room_preference, ga.share_consent, ga.needs_access
     from group_attendee ga join person p on p.id=ga.person_id where ga.group_id=$1`,
    [groupId],
  )).rows.map(shapeClient);
  const planned = planAssignments({
    rooms,
    clients: people,
    placements,
    span: { arrival: g.arrival, departure: g.departure },
    locked: lockedOn(g.arrival, settings.cutoff_days, londonToday()),
    staff: ctx.staff,
  });
  if (!planned.ok) {
    const status = planned.code === "locked" ? 403 : 422;
    return { ok: false as const, status, body: problem(status, planned.code, planned.error) };
  }
  const attendeeIds = people.map(person => person.personId);
  const extras = (await c.query(
    `select room_id, count(distinct occupant_label)::int n from room_occupancy
     where group_id=$1 and (person_id is null or not (person_id = any($2::uuid[]))) group by room_id`,
    [groupId, attendeeIds],
  )).rows;
  const extraByRoom = new Map(extras.map(row => [row.room_id as string, Number(row.n)]));
  const counts = new Map<string, number>();
  for (const place of placements) counts.set(place.roomId, (counts.get(place.roomId) ?? 0) + 1);
  for (const room of rooms) {
    const used = (counts.get(room.id) ?? 0) + (extraByRoom.get(room.id) ?? 0);
    if (used > room.capacity) return { ok: false as const, status: 422, body: problem(422, "capacity", `Room ${room.number} sleeps ${room.capacity}.`) };
  }
  const hds = halfDays({ arrival_date: g.arrival, arrival_slot: g.arrival_slot, departure_date: g.departure, departure_slot: g.departure_slot });
  for (const place of placements) {
    const room = rooms.find(item => item.id === place.roomId);
    if (!room) continue;
    const clash = await c.query(
      `select occupant_label from room_occupancy where room_id=$1 and group_id is distinct from $2 and (on_date::text, slot) in (select * from unnest($3::text[], $4::text[])) limit 1`,
      [room.id, groupId, hds.map(day => day.date), hds.map(day => day.slot)],
    );
    if (clash.rowCount) return { ok: false as const, status: 409, body: problem(409, "room_taken", `Room ${room.number} is taken on those dates.`) };
    const held = await c.query(
      `select g.name from group_room_hold h join booking_group g on g.id=h.group_id
       where h.room_id=$1 and h.group_id<>$2 and g.status not in ('CANCELLED','COMPLETED')
         and g.departure_date >= $3::date and g.arrival_date <= $4::date limit 1`,
      [room.id, groupId, g.arrival, g.departure],
    );
    if (held.rowCount) return { ok: false as const, status: 409, body: problem(409, "room_held", `Room ${room.number} is held for ${held.rows[0].name}.`) };
  }
  await c.query(`delete from room_occupancy where group_id=$1 and person_id = any($2::uuid[])`, [groupId, attendeeIds]);
  for (const place of placements) {
    const room = rooms.find(item => item.id === place.roomId);
    const person = people.find(item => item.personId === place.personId);
    if (!room || !person) continue;
    await c.query(
      `insert into room_occupancy (tenant_id, room_id, group_id, person_id, occupant_label, on_date, slot)
       select $1,$2,$3,$4,$5, d, s from unnest($6::date[], $7::text[]) as x(d, s)
       on conflict do nothing`,
      [ctx.tenantId, room.id, groupId, person.personId, person.name, hds.map(day => day.date), hds.map(day => day.slot)],
    );
  }
  return {
    ok: true as const,
    complete: planned.unassigned.length === 0 && people.length > 0,
    warnings: planned.warnings,
    unassigned: planned.unassigned,
    group: { id: g.id as string, name: g.name as string, contact_email: (g.contact_email as string | null) ?? null },
  };
}

async function placementsFromBody(c: Q, groupId: string, body: { placements?: { person_id?: string; room_id?: string }[]; person_id?: string; room_id?: string | null }): Promise<Placement[] | null> {
  if (Array.isArray(body.placements)) {
    if (body.placements.some(row => !row.person_id || !row.room_id)) return null;
    return body.placements.map(row => ({ personId: String(row.person_id), roomId: String(row.room_id) }));
  }
  if (!body.person_id) return null;
  const existing = (await c.query(`select distinct person_id, room_id from room_occupancy where group_id=$1 and person_id is not null`, [groupId])).rows;
  const map = new Map<string, string>(existing.map(row => [row.person_id as string, row.room_id as string]));
  if (body.room_id) map.set(body.person_id, body.room_id);
  else map.delete(body.person_id);
  return [...map].map(([personId, roomId]) => ({ personId, roomId }));
}

async function organiserBoard(session: OrgSession) {
  const settings = await loadSettings(session.propertyId);
  const groups = (await pool.query(
    `select id, name, organisation, colour, contact_email, status,
      arrival_date::text arrival, arrival_slot, departure_date::text departure, departure_slot
     from booking_group
     where property_id=$1 and id = any($2::uuid[]) and status <> 'CANCELLED'
     order by arrival_date`,
    [session.propertyId, session.groupIds],
  )).rows;
  const out = [];
  for (const g of groups) {
    const roomRows = (await pool.query(
      `select r.id, r.number, t.code type, r.max_capacity, r.features, r.beds_single, r.beds_double, r.beds_king
       from group_room_hold h join room r on r.id=h.room_id join room_type t on t.id=r.room_type_id
       where h.group_id=$1 order by r.number`,
      [g.id],
    )).rows;
    const rooms: RoomHold[] = roomRows.map(row => ({
      id: row.id, number: row.number, capacity: Number(row.max_capacity ?? 0), features: row.features ?? [],
      bedsSingle: Number(row.beds_single ?? 0), bedsDouble: Number(row.beds_double ?? 0), bedsKing: Number(row.beds_king ?? 0),
    }));
    const clientRows = (await pool.query(
      `select p.id person_id, p.given_name, p.family_name, p.email, ga.room_preference, ga.share_consent, ga.needs_access, ga.arrives_early,
        d.diet, d.allergens, d.severity, d.notes diet_notes
       from group_attendee ga join person p on p.id=ga.person_id
       left join diet_profile d on d.person_id=p.id
       where ga.group_id=$1 order by p.family_name, p.given_name`,
      [g.id],
    )).rows;
    const clients = clientRows.map(shapeClient);
    const placed = (await pool.query(
      `select distinct on (person_id) person_id, room_id from room_occupancy where group_id=$1 and person_id is not null order by person_id, on_date`,
      [g.id],
    )).rows;
    const roomOf = new Map(placed.map(row => [row.person_id as string, row.room_id as string]));
    const placements = [...roomOf].map(([personId, roomId]) => ({ personId, roomId }));
    const locked = g.arrival ? lockedOn(g.arrival, settings.cutoff_days, londonToday()) : false;
    const planned = g.arrival && g.departure
      ? planAssignments({ rooms, clients, placements, span: { arrival: g.arrival, departure: g.departure }, locked: false, staff: true })
      : null;
    const warnings: AssignWarning[] = planned?.ok ? planned.warnings : [];
    const byRoom = new Map<string, { person_id: string; name: string }[]>();
    for (const [personId, roomId] of roomOf) {
      const person = clients.find(item => item.personId === personId);
      const list = byRoom.get(roomId) ?? [];
      list.push({ person_id: personId, name: person?.name ?? "Guest" });
      byRoom.set(roomId, list);
    }
    out.push({
      id: g.id,
      name: g.name,
      organisation: g.organisation,
      colour: g.colour,
      arrival: g.arrival,
      arrival_slot: g.arrival_slot,
      departure: g.departure,
      departure_slot: g.departure_slot,
      locked,
      lock_from: g.arrival ? addDays(g.arrival, -settings.cutoff_days) : null,
      note: planned && !planned.ok ? planned.error : null,
      warnings: warnings.map(item => ({ person_id: item.personId, room_id: item.roomId, message: item.message })),
      unassigned: clients.filter(person => !roomOf.has(person.personId)).map(person => ({ person_id: person.personId, name: person.name })),
      rooms: roomRows.map(row => ({
        id: row.id,
        number: row.number,
        type: row.type,
        capacity: Number(row.max_capacity ?? 0),
        features: row.features ?? [],
        beds_single: Number(row.beds_single ?? 0),
        beds_double: Number(row.beds_double ?? 0),
        beds_king: Number(row.beds_king ?? 0),
        empty: Math.max(0, Number(row.max_capacity ?? 0) - (byRoom.get(row.id)?.length ?? 0)),
        occupants: byRoom.get(row.id) ?? [],
      })),
      clients: clientRows.map(row => {
        const person = shapeClient(row);
        return {
          person_id: person.personId,
          given_name: person.given_name,
          family_name: person.family_name,
          name: person.name,
          email: row.email,
          room_preference: row.room_preference,
          share_consent: !!row.share_consent,
          needs_access: !!row.needs_access,
          arrives_early: !!row.arrives_early,
          diet: openList(row.diet) ?? [],
          allergens: openList(row.allergens) ?? [],
          severity: row.severity,
          diet_notes: openText(row.diet_notes),
          room_id: roomOf.get(person.personId) ?? null,
        };
      }),
    });
  }
  return { cutoff_days: settings.cutoff_days, groups: out };
}

function allowAssign(a: Actor, reply: FastifyReply): boolean {
  if (a.perms.has("group.update") || a.perms.has("occupancy.write")) return true;
  reply.code(403).send(problem(403, "forbidden", "Your role cannot update room assignments"));
  return false;
}

export default async function roomAssignRoutes(f: FastifyInstance) {
  f.post<{ Body: { token?: string } }>("/public/organiser/from-form", async (req, reply) => {
    const token = String(req.body?.token ?? "");
    if (!token) return reply.code(422).send(problem(422, "validation", "This link is missing its code"));
    const g = (await pool.query(
      `select id, tenant_id, property_id, status from booking_group where form_token=$1`,
      [token],
    )).rows[0];
    if (!g) return reply.code(404).send(problem(404, "not_found", "This link is not valid"));
    if (g.status === "CANCELLED") return reply.code(410).send(problem(410, "gone", "This booking has been cancelled"));
    const session = await issueSession(g.tenant_id, g.property_id, [g.id], "form");
    await auditOrg(pool, g.tenant_id, g.property_id, g.id, "rooms.form_session", {});
    return session;
  });

  f.post<{ Body: { access_code?: string } }>("/public/organiser/session", async (req, reply) => {
    const auth = req.headers.authorization;
    const code = String(req.body?.access_code ?? "").trim();
    if (!code && auth?.startsWith("Bearer ")) {
      if (!rateOk(`orgguest:${req.ip || "x"}`)) return reply.code(429).send(problem(429, "rate_limited", "Too many sign-in attempts"));
      const guestToken = auth.slice(7);
      const guest = (await pool.query(
        `select g.tenant_id, g.property_id, g.email, g.email_verified
         from guest_session s join guest_account g on g.id=s.guest_id
         where s.token=$1 and s.expires_at > now() and g.status='ACTIVE'`,
        [guestToken],
      )).rows[0];
      if (!guest?.email_verified) return reply.code(401).send(problem(401, "unauthenticated", publicLoginDetail(accessOutcome({ found: false, hashMatches: false }))));
      const groups = (await pool.query(
        `select bg.id from booking_group bg
         left join person op on op.id=bg.organiser_person_id
         where bg.property_id=$1 and bg.status <> 'CANCELLED'
           and (lower(bg.contact_email)=lower($2) or lower(op.email)=lower($2))`,
        [guest.property_id, guest.email],
      )).rows;
      if (!groups.length) return reply.code(404).send(problem(404, "not_found", NOT_YOURS));
      return issueSession(guest.tenant_id, guest.property_id, groups.map(row => row.id as string), "guest");
    }
    if (!rateOk(`orgcode:${req.ip || "x"}`)) return reply.code(429).send(problem(429, "rate_limited", "Too many sign-in attempts"));
    if (code.length < 20) return reply.code(401).send(problem(401, "unauthenticated", publicLoginDetail(accessOutcome({ found: false, hashMatches: false }))));
    const row = (await pool.query(`select * from organiser_access where code_hash=$1`, [hashOrganiserCode(code)])).rows[0];
    const check = organiserCodeCheck({
      found: !!row,
      revoked: !!row?.revoked_at,
      hashMatches: !!row,
      expiresAt: row?.expires_at,
      lockedUntil: row?.locked_until,
    });
    if (!check.ok) {
      if (row && !row.revoked_at) {
        const next = nextFailedAttempts(Number(row.failed_attempts ?? 0));
        await pool.query(`update organiser_access set failed_attempts=$2, locked_until=$3 where id=$1`, [row.id, next.attempts, next.lockedUntil]);
      }
      return reply.code(401).send(problem(401, "unauthenticated", publicLoginDetail(check)));
    }
    await pool.query(`update organiser_access set failed_attempts=0, locked_until=null where id=$1`, [row.id]);
    const g = (await pool.query(`select id, tenant_id, property_id, status from booking_group where id=$1`, [row.group_id])).rows[0];
    if (!g || g.status === "CANCELLED") return reply.code(401).send(problem(401, "unauthenticated", publicLoginDetail(accessOutcome({ found: false, hashMatches: false }))));
    return issueSession(g.tenant_id, g.property_id, [g.id], "code");
  });

  f.get("/public/organiser/board", async (req, reply) => {
    const session = await requireOrganiser(req, reply); if (!session) return;
    return organiserBoard(session);
  });

  f.post<{ Body: { group_id?: string; attendees?: AttendeeIn[] } }>("/public/organiser/attendees", async (req, reply) => {
    const session = await requireOrganiser(req, reply); if (!session) return;
    const groupId = String(req.body?.group_id ?? "");
    const attendees = req.body?.attendees ?? [];
    if (!session.groupIds.includes(groupId)) return reply.code(404).send(problem(404, "not_found", NOT_YOURS));
    if (!Array.isArray(attendees) || attendees.length === 0) return reply.code(422).send(problem(422, "validation", "Add at least one guest"));
    if (attendees.length > 200) return reply.code(422).send(problem(422, "validation", "Too many guests in one submission"));
    for (const [i, at] of attendees.entries()) {
      if (!at.given_name?.trim() || !at.family_name?.trim()) return reply.code(422).send(problem(422, "validation", `Guest ${i + 1} needs a first and last name`));
      if ((at.allergens ?? []).length && !at.severity) return reply.code(422).send(problem(422, "validation", `Say how serious ${at.given_name}'s allergy is`));
      if (at.severity && !SEVERITY.includes(at.severity)) return reply.code(422).send(problem(422, "validation", "That allergy severity is not one we record"));
    }
    const saved = await tx(async c => {
      const g = await groupBundle(c, session.propertyId, groupId, session.groupIds);
      if (!g) { reply.code(404); return problem(404, "not_found", NOT_YOURS); }
      if (g.status === "CANCELLED") { reply.code(410); return problem(410, "gone", "This booking has been cancelled"); }
      for (const at of attendees) {
        if (!at.person_id) continue;
        const own = (await c.query(`select person_id from group_attendee where group_id=$1 and person_id=$2`, [g.id, at.person_id])).rows[0];
        if (!own) { reply.code(404); return problem(404, "not_found", NOT_YOURS); }
      }
      let created = 0, updated = 0;
      for (const at of attendees) {
        const pref = at.room_preference === "single" || at.room_preference === "twin" || at.room_preference === "any" ? at.room_preference : null;
        const share = pref === "twin" || !!at.share_consent;
        let pid: string | undefined;
        if (at.person_id) {
          const own = (await c.query(`select person_id from group_attendee where group_id=$1 and person_id=$2`, [g.id, at.person_id])).rows[0];
          if (!own) { reply.code(404); return problem(404, "not_found", NOT_YOURS); }
          pid = own.person_id;
          updated++;
          await c.query(`update person set given_name=$2, family_name=$3, email=coalesce($4,email), phone=coalesce($5,phone) where id=$1`, [pid, at.given_name!.trim(), at.family_name!.trim(), at.email?.trim() || null, at.phone?.trim() || null]);
        } else {
          const existing = (await c.query(
            `select p.id from group_attendee ga join person p on p.id=ga.person_id where ga.group_id=$1 and lower(p.given_name)=lower($2) and lower(p.family_name)=lower($3)`,
            [g.id, at.given_name!.trim(), at.family_name!.trim()],
          )).rows[0];
          if (existing) { pid = existing.id; updated++; await c.query(`update person set email=coalesce($2,email), phone=coalesce($3,phone) where id=$1`, [pid, at.email?.trim() || null, at.phone?.trim() || null]); }
          else {
            pid = (await c.query(
              `insert into person (tenant_id, given_name, family_name, email, phone) values ($1,$2,$3,$4,$5) returning id`,
              [g.tenant_id, at.given_name!.trim(), at.family_name!.trim(), at.email?.trim() || null, at.phone?.trim() || null],
            )).rows[0].id;
            created++;
          }
        }
        await c.query(
          `insert into group_attendee (tenant_id, group_id, person_id, room_preference, arrives_early, share_consent, needs_access)
           values ($1,$2,$3,$4,$5,$6,$7)
           on conflict (group_id, person_id) do update set room_preference=excluded.room_preference, arrives_early=excluded.arrives_early,
             share_consent=excluded.share_consent, needs_access=excluded.needs_access, submitted_at=now()`,
          [g.tenant_id, g.id, pid, pref, !!at.arrives_early, share, !!at.needs_access],
        );
        const allergens = (at.allergens ?? []).filter(item => ALLERGENS.includes(item));
        await c.query(
          `insert into diet_profile (tenant_id, person_id, diet, allergens, severity, notes, declared_at, version)
           values ($1,$2,$3,$4,$5,$6, now(), 1)
           on conflict (person_id) do update set diet=excluded.diet, allergens=excluded.allergens, severity=excluded.severity, notes=excluded.notes, declared_at=now(), version=diet_profile.version+1`,
          [g.tenant_id, pid, sealList(at.diet ?? []), sealList(allergens), allergens.length ? at.severity : (at.severity || null), sealText(at.diet_notes || null)],
        );
        await c.query(`update room_occupancy set occupant_label=$3 where group_id=$1 and person_id=$2`, [g.id, pid, `${at.given_name!.trim()} ${at.family_name!.trim()}`]);
      }
      await auditOrg(c, g.tenant_id, g.property_id, g.id, "rooms.attendees", { created, updated });
      return { ok: true, created, updated };
    });
    return saved;
  });

  f.post<{ Body: { group_id?: string; person_id?: string } }>("/public/organiser/attendees/remove", async (req, reply) => {
    const session = await requireOrganiser(req, reply); if (!session) return;
    const groupId = String(req.body?.group_id ?? "");
    const personId = String(req.body?.person_id ?? "");
    if (!session.groupIds.includes(groupId)) return reply.code(404).send(problem(404, "not_found", NOT_YOURS));
    return tx(async c => {
      const g = await groupBundle(c, session.propertyId, groupId, session.groupIds);
      if (!g) { reply.code(404); return problem(404, "not_found", NOT_YOURS); }
      const settings = await loadSettings(session.propertyId);
      const locked = g.arrival ? lockedOn(g.arrival, settings.cutoff_days, londonToday()) : false;
      const placed = (await c.query(`select 1 from room_occupancy where group_id=$1 and person_id=$2 limit 1`, [groupId, personId])).rowCount;
      if (locked && placed) { reply.code(403); return problem(403, "locked", "The house has locked room changes. Ask the house if something needs to move."); }
      await c.query(`delete from room_occupancy where group_id=$1 and person_id=$2`, [groupId, personId]);
      const removed = await c.query(`delete from group_attendee where group_id=$1 and person_id=$2`, [groupId, personId]);
      if (!removed.rowCount) { reply.code(404); return problem(404, "not_found", NOT_YOURS); }
      await auditOrg(c, session.tenantId, session.propertyId, groupId, "rooms.attendee_remove", { person_id: personId });
      return { ok: true };
    });
  });

  f.post<{ Body: { group_id?: string; placements?: { person_id?: string; room_id?: string }[]; person_id?: string; room_id?: string | null } }>("/public/organiser/assignments", async (req, reply) => {
    const session = await requireOrganiser(req, reply); if (!session) return;
    const groupId = String(req.body?.group_id ?? "");
    if (!session.groupIds.includes(groupId)) return reply.code(404).send(problem(404, "not_found", NOT_YOURS));
    const saved = await tx(async c => {
      const placements = await placementsFromBody(c, groupId, req.body ?? {});
      if (!placements) { reply.code(422); return problem(422, "validation", "Say which guest goes in which room"); }
      const result = await writeAssignments(c, { tenantId: session.tenantId, propertyId: session.propertyId, owned: session.groupIds, staff: false }, groupId, placements);
      if (!result.ok) { reply.code(result.status); return result.body; }
      await auditOrg(c, session.tenantId, session.propertyId, groupId, "rooms.assign", { people: placements.length, complete: result.complete });
      return result;
    });
    if (saved && typeof saved === "object" && "ok" in saved && saved.ok === true && "group" in saved) {
      await notifyAssignment(session, saved.group, saved.complete);
      return { ok: true, complete: saved.complete, warnings: saved.warnings, unassigned: saved.unassigned };
    }
    return saved;
  });

  f.post<{ Body: { group_id?: string; note?: string } }>("/public/organiser/change-request", async (req, reply) => {
    const session = await requireOrganiser(req, reply); if (!session) return;
    const groupId = String(req.body?.group_id ?? "");
    const note = String(req.body?.note ?? "").trim();
    if (!session.groupIds.includes(groupId)) return reply.code(404).send(problem(404, "not_found", NOT_YOURS));
    if (!note) return reply.code(422).send(problem(422, "validation", "Say what needs to change"));
    const g = await groupBundle(pool, session.propertyId, groupId, session.groupIds);
    if (!g) return reply.code(404).send(problem(404, "not_found", NOT_YOURS));
    const settings = await loadSettings(session.propertyId);
    const locked = g.arrival ? lockedOn(g.arrival, settings.cutoff_days, londonToday()) : false;
    if (!locked) return reply.code(409).send(problem(409, "open", "The room list is still open. Save the change directly."));
    await auditOrg(pool, session.tenantId, session.propertyId, groupId, "rooms.change_request", { note });
    if (settings.staff_email.includes("@")) {
      await sendEmail(session, {
        to: settings.staff_email,
        subject: `Room change requested — ${g.name}`,
        body: `The organiser for ${g.name} asked for a room change after the list was locked.\n\n${note}`,
        kind: "organiser_rooms",
        related_type: "booking_group",
        related_id: groupId,
      });
    }
    return { ok: true };
  });

  f.get<{ Querystring: { from?: string; to?: string; group_id?: string; room?: string } }>("/v1/room-assign", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.read", reply)) return;
    const from = req.query.from ?? "";
    const to = req.query.to ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return reply.code(422).send(problem(422, "validation", "Choose a from and to date"));
    const rooms = (await pool.query(
      `select r.id, r.number, r.section, t.code type, r.max_capacity, r.features, r.beds_single, r.beds_double, r.beds_king
       from room r join room_type t on t.id=r.room_type_id
       where r.property_id=$1 and r.staff_only=false order by r.section, r.number`,
      [a.propertyId],
    )).rows;
    const groups = (await pool.query(
      `select id, name, organisation, colour, contact_email, status, arrival_date::text arrival, arrival_slot, departure_date::text departure, departure_slot
       from booking_group
       where property_id=$1 and status <> 'CANCELLED' and departure_date >= $2::date and arrival_date <= $3::date
       order by arrival_date, name`,
      [a.propertyId, from, to],
    )).rows;
    const occupancy = (await pool.query(
      `select o.room_id, r.number room, o.on_date::text date, o.slot, o.group_id, o.person_id, o.occupant_label client, g.name group_name, g.colour
       from room_occupancy o join room r on r.id=o.room_id
       left join booking_group g on g.id=o.group_id
       where r.property_id=$1 and o.on_date between $2::date and $3::date
       order by r.number, o.on_date, o.slot, o.occupant_label`,
      [a.propertyId, from, to],
    )).rows;
    const holds = (await pool.query(
      `select h.group_id, h.room_id, r.number room, g.name, g.colour, g.arrival_date::text arrival, g.departure_date::text departure
       from group_room_hold h join room r on r.id=h.room_id join booking_group g on g.id=h.group_id
       where h.property_id=$1 and g.status <> 'CANCELLED' and g.departure_date >= $2::date and g.arrival_date <= $3::date`,
      [a.propertyId, from, to],
    )).rows;
    const ids = groups.map(row => row.id as string);
    const attendees = ids.length ? (await pool.query(
      `select ga.group_id, ga.person_id, p.given_name, p.family_name, ga.room_preference, ga.share_consent, ga.needs_access
       from group_attendee ga join person p on p.id=ga.person_id
       where ga.group_id = any($1::uuid[]) order by p.family_name, p.given_name`,
      [ids],
    )).rows : [];
    const found = conflicts(occupancy.filter(row => row.group_id).map(row => ({
      roomId: row.room_id as string,
      date: row.date as string,
      slot: row.slot as string,
      groupId: row.group_id as string,
    })));
    return { from, to, rooms, groups, occupancy, holds, attendees, conflicts: found, settings: await loadSettings(a.propertyId) };
  });

  f.get<{ Querystring: { from?: string; to?: string; group_id?: string; room?: string } }>("/v1/room-assign.csv", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.read", reply)) return;
    const from = req.query.from ?? "";
    const to = req.query.to ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return reply.code(422).send(problem(422, "validation", "Choose a from and to date"));
    const rows = (await pool.query(
      `select distinct r.number room, o.on_date::text date, coalesce(g.name, '') as group_name, o.occupant_label client
       from room_occupancy o join room r on r.id=o.room_id
       left join booking_group g on g.id=o.group_id
       where r.property_id=$1 and o.on_date between $2::date and $3::date
         and ($4::uuid is null or o.group_id=$4) and ($5::text is null or r.number=$5)
       order by r.number, o.on_date::text, o.occupant_label`,
      [a.propertyId, from, to, req.query.group_id || null, req.query.room || null],
    )).rows;
    const csv = assignmentCsv(rows.map(row => ({ room: row.room, date: row.date, group: row.group_name, client: row.client })));
    reply.header("content-disposition", `attachment; filename="room-allocation-${from}.csv"`);
    return reply.type("text/csv").send(csv);
  });

  f.get("/v1/room-assign/settings", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.read", reply)) return;
    return loadSettings(a.propertyId);
  });

  f.put<{ Body: { cutoff_days?: number; staff_email?: string } }>("/v1/room-assign/settings", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.update", reply)) return;
    const settings = parseRoomSettings(req.body ?? {});
    await pool.query(
      `update property set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{rooms}', $2::jsonb, true) where id=$1`,
      [a.propertyId, JSON.stringify(settings)],
    );
    await audit(pool as unknown as Q, a, "property", a.propertyId, "rooms.settings", { payload: { cutoff_days: settings.cutoff_days } });
    return settings;
  });

  f.post<{ Params: { id: string }; Body: { room_ids?: string[] } }>("/v1/groups/:id/room-holds", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allowAssign(a, reply)) return;
    const roomIds = req.body?.room_ids ?? [];
    if (!Array.isArray(roomIds)) return reply.code(422).send(problem(422, "validation", "Choose the rooms to hold"));
    return tx(async c => {
      const g = await groupBundle(c, a.propertyId, req.params.id, null);
      if (!g) { reply.code(404); return problem(404, "not_found", "No such booking"); }
      const rooms = (await c.query(`select id from room where property_id=$1 and staff_only=false and id = any($2::uuid[])`, [a.propertyId, roomIds])).rows;
      if (rooms.length !== roomIds.length) { reply.code(422); return problem(422, "validation", "One of those rooms is not a guest room"); }
      await c.query(`delete from group_room_hold where group_id=$1`, [g.id]);
      if (roomIds.length) {
        await c.query(
          `insert into group_room_hold (tenant_id, property_id, group_id, room_id, created_by) select $1,$2,$3, x, $4 from unnest($5::uuid[]) x`,
          [a.tenantId, a.propertyId, g.id, a.userId, roomIds],
        );
      }
      await audit(c, a, "booking_group", g.id, "rooms.hold", { payload: { rooms: roomIds.length } });
      return { ok: true, rooms: roomIds.length };
    });
  });

  f.post<{ Params: { id: string }; Body: { placements?: { person_id?: string; room_id?: string }[]; person_id?: string; room_id?: string | null } }>("/v1/groups/:id/room-assign", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allowAssign(a, reply)) return;
    const saved = await tx(async c => {
      const placements = await placementsFromBody(c, req.params.id, req.body ?? {});
      if (!placements) { reply.code(422); return problem(422, "validation", "Say which guest goes in which room"); }
      const result = await writeAssignments(c, { tenantId: a.tenantId, propertyId: a.propertyId, owned: null, staff: true }, req.params.id, placements);
      if (!result.ok) { reply.code(result.status); return result.body; }
      await audit(c, a, "booking_group", req.params.id, "rooms.assign", { payload: { people: placements.length, staff: true } });
      return result;
    });
    if (saved && typeof saved === "object" && "ok" in saved && saved.ok === true && "group" in saved) {
      await notifyAssignment(a, saved.group, saved.complete);
    }
    return saved;
  });

  f.post<{ Params: { id: string } }>("/v1/groups/:id/organiser-code", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.update", reply)) return;
    const plain = newOrganiserCode();
    const issued = await tx(async c => {
      const g = await groupBundle(c, a.propertyId, req.params.id, null);
      if (!g) { reply.code(404); return problem(404, "not_found", "No such booking"); }
      await c.query(`update organiser_access set revoked_at=now() where group_id=$1 and revoked_at is null`, [g.id]);
      const expires = issueExpiry();
      await c.query(
        `insert into organiser_access (tenant_id, property_id, group_id, code_hash, expires_at, created_by) values ($1,$2,$3,$4,$5,$6)`,
        [a.tenantId, a.propertyId, g.id, hashOrganiserCode(plain), expires, a.userId],
      );
      await audit(c, a, "booking_group", g.id, "rooms.code", { payload: { rotated: true, emailed: !!(g.contact_email && String(g.contact_email).includes("@")) } });
      return { expires_at: expires.toISOString(), contact_email: (g.contact_email as string | null) ?? null, name: g.name as string };
    });
    if (!issued || !("expires_at" in issued)) return issued;
    let emailed = false;
    if (issued.contact_email?.includes("@")) {
      await sendEmail(a, {
        to: issued.contact_email,
        subject: `Room list access — ${issued.name}`,
        body: `Your access code for ${issued.name} is:\n\n${plain}\n\nIt expires on ${issued.expires_at.slice(0, 10)}. If you did not expect this, ignore this email.`,
        kind: "organiser_rooms",
        related_type: "booking_group",
        related_id: req.params.id,
      });
      emailed = true;
    }
    return { code: plain, expires_at: issued.expires_at, emailed };
  });

  f.post<{ Params: { id: string } }>("/v1/groups/:id/organiser-code/revoke", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.update", reply)) return;
    const g = await groupBundle(pool, a.propertyId, req.params.id, null);
    if (!g) return reply.code(404).send(problem(404, "not_found", "No such booking"));
    await pool.query(`update organiser_access set revoked_at=now() where group_id=$1 and property_id=$2 and revoked_at is null`, [g.id, a.propertyId]);
    await audit(pool as unknown as Q, a, "booking_group", g.id, "rooms.code_revoke", {});
    return { ok: true };
  });
}
