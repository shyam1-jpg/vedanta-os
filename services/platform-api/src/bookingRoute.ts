/**
 * Store a guest booking, carry it onto the house book, and keep department tasks in step.
 * Emails are returned for the caller to send through the shared email helper.
 */
import type { FastifyInstance } from "fastify";
import { pool } from "./db.ts";
import { allow, problem, requireActor } from "./auth.ts";
import { openText, sealList, sealText } from "./fieldCrypto.ts";
import { linkReturningGuest } from "./guestHistory.ts";
import {
  acceptWarning,
  bookingEmails,
  cancellationEmails,
  captureFromStored,
  departmentSlices,
  accessSummary,
  dietarySummary,
  formatSlice,
  highestSeverity,
  kitchenSlice,
  parseRoutingRules,
  reconcileRoutes,
  roomPersonPlan,
  taskPriority,
  validateCapture,
  type CaptureInput,
  type OutboundNote,
  type PartyGuest,
  type RoutingDepartment,
  type RoutingRules,
  type StayCapture,
} from "../../../domains/guest/booking.ts";

export type Db = { query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };

export function sealParty(party: PartyGuest[], extra?: { access?: string[]; access_note?: string | null }): string | null {
  const access = extra?.access ?? [];
  const access_note = extra?.access_note ?? null;
  const payload = access.length || access_note ? { party, access, access_note } : party;
  return sealText(JSON.stringify(payload));
}

export function openPartyBundle(raw: string | null | undefined): { party: unknown; access: string[]; access_note: string | null } {
  const text = openText(raw);
  if (!text) return { party: [], access: [], access_note: null };
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return { party: parsed, access: [], access_note: null };
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.party)) {
      return {
        party: parsed.party,
        access: Array.isArray(parsed.access) ? parsed.access.map(String) : [],
        access_note: typeof parsed.access_note === "string" ? parsed.access_note : null,
      };
    }
  } catch { /* sealed text that is not JSON falls through */ }
  return { party: [], access: [], access_note: null };
}

export function openParty(raw: string | null | undefined): unknown {
  return openPartyBundle(raw).party;
}

export function openAllergenDetail(raw: string | null | undefined): { code: string; severity: string }[] {
  const text = openText(raw);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function clock(note: string | null): string | null {
  const m = note?.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!m) return null;
  const h = Number(m[1]);
  if (h > 23 || Number(m[2]) > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}:00`;
}

export function enquiryInput(row: {
  people?: number; name?: string; email?: string;
  arrival?: string; departure?: string; arrival_date?: string | Date; departure_date?: string | Date;
  arrival_slot?: string | null; departure_slot?: string | null;
  party?: string | null; dietary_notes?: string | null; accessibility_notes?: string | null;
  arrival_time_note?: string | null; room_preference?: string | null; travel_notes?: string | null; notes?: string | null;
}): CaptureInput {
  const date = (v: string | Date | undefined) => v instanceof Date ? v.toISOString().slice(0, 10) : (v ? String(v).slice(0, 10) : undefined);
  const bundle = openPartyBundle(row.party);
  return {
    people: row.people,
    name: row.name,
    email: row.email,
    arrival: row.arrival ?? date(row.arrival_date),
    departure: row.departure ?? date(row.departure_date),
    arrival_slot: row.arrival_slot,
    departure_slot: row.departure_slot,
    party: bundle.party,
    access: bundle.access,
    access_note: bundle.access_note,
    dietary_notes: openText(row.dietary_notes),
    accessibility_notes: openText(row.accessibility_notes),
    arrival_time_note: row.arrival_time_note,
    room_preference: row.room_preference,
    travel_notes: openText(row.travel_notes),
    notes: row.notes,
  };
}

export async function loadRoutingRules(db: Db, propertyId: string): Promise<RoutingRules> {
  const row = (await db.query(`select settings from property where id=$1`, [propertyId])).rows[0];
  return parseRoutingRules(row?.settings?.booking_routing);
}

export async function saveRoutingRules(db: Db, propertyId: string, rules: RoutingRules): Promise<void> {
  await db.query(
    `update property set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{booking_routing}', $2::jsonb, true) where id=$1`,
    [propertyId, JSON.stringify(rules)],
  );
}

async function writeTaskEvent(db: Db, args: { tenantId: string; propertyId: string; taskId: string; to: string; body: string; actorId?: string | null }) {
  await db.query(
    `insert into ops_task_event (task_id, tenant_id, property_id, kind, actor_id, to_status, body)
     values ($1,$2,$3,'status',$4,$5,$6)`,
    [args.taskId, args.tenantId, args.propertyId, args.actorId ?? null, args.to, args.body],
  );
}

export async function syncBookingTasks(db: Db, args: {
  tenantId: string; propertyId: string; enquiryId: string; bookingId: string | null;
  stay: StayCapture; rules: RoutingRules; actorId?: string | null;
}): Promise<void> {
  const slices = departmentSlices(args.stay, args.rules);
  const desired = slices.map(s => s.department);
  const existing = await db.query(
    `select id, department, status from ops_task where property_id=$1 and source='guest_booking' and event_label=$2`,
    [args.propertyId, args.enquiryId],
  );
  const plan = reconcileRoutes(existing.rows.map((r: { department: RoutingDepartment; status: string }) => ({ department: r.department, status: r.status })), desired);
  const due = `${args.stay.arrival}T12:00:00Z`;
  for (const slice of slices) {
    const notes = formatSlice(slice);
    const rank = taskPriority(slice);
    const title = slice.department === "KITCHEN"
      ? `Diet — ${args.stay.name}${slice.severe ? " — SEVERE" : ""}`
      : slice.department === "RESTAURANT" ? `Meals — ${args.stay.name}` : slice.department === "HK" ? `Access — ${args.stay.name}` : `Arrival — ${args.stay.name}`;
    if (plan.update.includes(slice.department)) {
      await db.query(
        `update ops_task set title=$3, notes=$4, priority=$5, severity=$6, guest_name=$7, booking_id=$8, due_at=$9, updated_at=now()
         where property_id=$1 and source='guest_booking' and event_label=$2 and department=$10 and status not in ('cancelled','verified')`,
        [args.propertyId, args.enquiryId, title, notes, rank.priority, rank.severity, args.stay.name, args.bookingId, due, slice.department],
      );
    } else if (plan.create.includes(slice.department)) {
      const created = await db.query(
        `insert into ops_task (
           tenant_id, property_id, title, notes, department, guest_name, booking_id, event_label,
           priority, severity, status, due_at, source
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'new',$11,'guest_booking') returning id`,
        [args.tenantId, args.propertyId, title, notes, slice.department, args.stay.name, args.bookingId, args.enquiryId, rank.priority, rank.severity, due],
      );
      await writeTaskEvent(db, { tenantId: args.tenantId, propertyId: args.propertyId, taskId: created.rows[0].id, to: "new", body: "Opened from a guest booking", actorId: args.actorId });
    }
  }
  for (const department of plan.withdraw) {
    const rows = await db.query(
      `update ops_task set status='cancelled', updated_at=now()
       where property_id=$1 and source='guest_booking' and event_label=$2 and department=$3 and status not in ('cancelled','verified')
       returning id`,
      [args.propertyId, args.enquiryId, department],
    );
    for (const row of rows.rows) {
      await writeTaskEvent(db, { tenantId: args.tenantId, propertyId: args.propertyId, taskId: row.id, to: "cancelled", body: "Withdrawn — the booking no longer needs this department", actorId: args.actorId });
    }
  }
}

export async function withdrawGuestBooking(db: Db, args: { tenantId: string; propertyId: string; enquiryId?: string | null; bookingId?: string | null; actorId?: string | null }) {
  if (!args.enquiryId && !args.bookingId) return;
  const rows = await db.query(
    `update ops_task set status='cancelled', updated_at=now()
     where property_id=$1 and source='guest_booking' and status not in ('cancelled','verified')
       and (($2::text is not null and event_label=$2) or ($3::uuid is not null and booking_id=$3))
     returning id`,
    [args.propertyId, args.enquiryId ?? null, args.bookingId ?? null],
  );
  for (const row of rows.rows) {
    await writeTaskEvent(db, { tenantId: args.tenantId, propertyId: args.propertyId, taskId: row.id, to: "cancelled", body: "Withdrawn — the stay was cancelled", actorId: args.actorId });
  }
  if (args.bookingId) {
    await db.query(`update guest_enquiry set status='CANCELLED' where property_id=$1 and booking_id=$2 and status in ('ENQUIRY','ACKNOWLEDGED','CONVERTED')`, [args.propertyId, args.bookingId]);
  }
}

export async function refreshGuestBookingForGroup(db: Db, tenantId: string, propertyId: string, bookingId: string) {
  const enquiry = (await db.query(
    `select e.*, e.arrival_date::text arrival, e.departure_date::text departure from guest_enquiry e where e.booking_id=$1 and e.property_id=$2 and e.status <> 'CANCELLED' order by e.created_at desc limit 1`,
    [bookingId, propertyId],
  )).rows[0];
  if (!enquiry) return;
  const group = (await db.query(
    `select arrival_date::text arrival, departure_date::text departure, arrival_slot, departure_slot from booking_group where id=$1`,
    [bookingId],
  )).rows[0];
  if (!group) return;
  const { capture } = captureFromStored(enquiryInput(enquiry));
  capture.arrival = group.arrival;
  capture.departure = group.departure;
  capture.arrival_slot = group.arrival_slot === "AM" ? "AM" : "PM";
  capture.departure_slot = group.departure_slot === "PM" ? "PM" : "AM";
  const rules = await loadRoutingRules(db, propertyId);
  await syncBookingTasks(db, { tenantId, propertyId, enquiryId: enquiry.id, bookingId, stay: capture, rules });
}

export async function carryOntoBooking(db: Db, args: {
  tenantId: string; propertyId: string; bookingId: string; stay: StayCapture; actorUserId?: string | null; keepAllergens?: boolean;
}): Promise<{ people: { id: string; label: string }[] }> {
  const summary = dietarySummary(args.stay);
  const guestNotes = [args.stay.notes, args.stay.arrival_time_note ? `Arrival: ${args.stay.arrival_time_note}` : null].filter(Boolean).join("\n");
  await db.query(
    `update booking_group set
       expected_guests=$2,
       arrival_slot=$10,
       departure_slot=$11,
       dietary_notes=$3,
       accessibility_notes=$4,
       room_preference=$5,
       arrival_time_note=$6,
       travel_notes=$7,
       arrival_time=coalesce($8::time, arrival_time),
       notes=case
         when $9::text is null or $9='' then notes
         when notes is null or notes='' then $9
         when position($9 in notes) > 0 then notes
         else notes || E'\n' || $9
       end
     where id=$1`,
    [
      args.bookingId,
      args.stay.party.length || args.stay.people,
      sealText(summary),
      sealText(args.stay.accessibility_notes),
      args.stay.room_preference,
      args.stay.arrival_time_note,
      sealText(args.stay.travel_notes),
      clock(args.stay.arrival_time_note),
      guestNotes || null,
      args.stay.arrival_slot,
      args.stay.departure_slot,
    ],
  );
  const people: { id: string; label: string }[] = [];
  for (const [index, person] of args.stay.party.entries()) {
    const existing = (await db.query(
      `select p.id from group_attendee ga join person p on p.id=ga.person_id
       where ga.group_id=$1 and lower(p.given_name)=lower($2) and lower(p.family_name)=lower($3)`,
      [args.bookingId, person.given_name, person.family_name],
    )).rows[0];
    const personId = await linkReturningGuest(db, {
      tenantId: args.tenantId,
      propertyId: args.propertyId,
      existingId: existing?.id,
      givenName: person.given_name,
      familyName: person.family_name,
      email: index === 0 ? args.stay.email : null,
      groupId: args.bookingId,
      actorUserId: args.actorUserId,
      arrival: args.stay.arrival,
      departure: args.stay.departure,
      roomPreference: args.stay.room_preference,
      accessibility: person.accessibility || args.stay.accessibility_notes,
      specialRequests: index === 0 ? args.stay.notes : null,
      keepAllergens: index === 0 && !!args.keepAllergens,
      diet: person.diet,
      allergens: person.allergens,
      dietNotes: person.other,
    });
    await db.query(
      `insert into group_attendee (tenant_id, group_id, person_id, room_preference)
       values ($1,$2,$3,$4)
       on conflict (group_id, person_id) do update set room_preference=excluded.room_preference, submitted_at=now()`,
      [args.tenantId, args.bookingId, personId, person.plate === "buffet" ? args.stay.room_preference : `${args.stay.room_preference ?? ""} ${person.plate}`.trim()],
    );
    const codes = person.allergens.map(a => a.code);
    const severity = highestSeverity(person.allergens.map(a => a.severity));
    await db.query(
      `insert into diet_profile (tenant_id, person_id, diet, allergens, severity, notes, allergen_detail, declared_by_user_id, declared_at, version)
       values ($1,$2,$3,$4,$5,$6,$7,$8, now(), 1)
       on conflict (person_id) do update set diet=excluded.diet, allergens=excluded.allergens, severity=excluded.severity, notes=excluded.notes,
         allergen_detail=excluded.allergen_detail, declared_by_user_id=excluded.declared_by_user_id, declared_at=now(), version=diet_profile.version+1`,
      [args.tenantId, personId, sealList(person.diet), sealList(codes), severity, sealText(person.other), sealText(JSON.stringify(person.allergens)), args.actorUserId ?? null],
    );
    if (!personId) throw new Error("person was not created");
    people.push({ id: personId, label: `${person.given_name} ${person.family_name}`.trim() });
  }
  const ids = people.map(p => p.id);
  if (ids.length) {
    await db.query(`delete from room_occupancy where group_id=$1 and person_id is not null and not (person_id = any($2::uuid[]))`, [args.bookingId, ids]);
    await db.query(`delete from group_attendee where group_id=$1 and not (person_id = any($2::uuid[]))`, [args.bookingId, ids]);
    await db.query(`update booking_group set organiser_person_id=coalesce(organiser_person_id, $2) where id=$1`, [args.bookingId, ids[0]]);
  }
  await linkExistingRooms(db, { tenantId: args.tenantId, propertyId: args.propertyId, bookingId: args.bookingId, people, fallbackLabel: args.stay.name, arrival: args.stay.arrival, departure: args.stay.departure });
  return { people };
}

async function linkExistingRooms(db: Db, args: {
  tenantId: string; propertyId: string; bookingId: string; people: { id: string; label: string }[];
  fallbackLabel: string; arrival: string; departure: string;
}) {
  if (!args.people.length) return;
  const rooms = (await db.query(
    `select distinct r.number from room_occupancy o join room r on r.id=o.room_id where o.group_id=$1 order by r.number`,
    [args.bookingId],
  )).rows.map((r: { number: string }) => r.number);
  if (!rooms.length) {
    if (args.people.length === 1) {
      await db.query(`update room_occupancy set person_id=$2 where group_id=$1 and person_id is null`, [args.bookingId, args.people[0].id]);
    }
    return;
  }
  const plan = roomPersonPlan(rooms, args.people, args.fallbackLabel);
  for (const link of plan) {
    if (!link.personId) continue;
    await db.query(
      `update room_occupancy o set person_id=$4, occupant_label=$5
       from room r
       where r.id=o.room_id and r.property_id=$1 and r.number=$2 and o.group_id=$3 and o.person_id is null and o.occupant_label=$6`,
      [args.propertyId, link.room, args.bookingId, link.personId, link.label, args.fallbackLabel],
    );
    await db.query(
      `insert into room_occupancy(tenant_id, room_id, group_id, person_id, occupant_label, on_date, slot)
       select $1, r.id, $2, $3, $4, d::date, s
       from room r
       cross join generate_series($5::date, greatest($6::date - 1, $5::date), interval '1 day') d
       cross join (values ('AM'),('PM')) v(s)
       where r.property_id=$7 and r.number=$8
       on conflict do nothing`,
      [args.tenantId, args.bookingId, link.personId, link.label, args.arrival, args.departure, args.propertyId, link.room],
    );
  }
}

export async function placeGuestRooms(db: Db, args: {
  tenantId: string; propertyId: string; bookingId: string; rooms: string[];
  people: { id: string; label: string }[]; fallbackLabel: string; arrival: string; departure: string;
}): Promise<{ ok: true; placed: { room: string; personId: string | null; label: string }[] } | { ok: false; status: number; code: string; detail: string }> {
  const plan = roomPersonPlan(args.rooms, args.people, args.fallbackLabel);
  const ready: { id: string; link: { room: string; personId: string | null; label: string } }[] = [];
  for (const link of plan) {
    const room = (await db.query(`select id, staff_only, status from room where property_id=$1 and number=$2`, [args.propertyId, link.room])).rows[0];
    if (!room) return { ok: false, status: 404, code: "not_found", detail: `No room ${link.room}` };
    if (room.staff_only) return { ok: false, status: 409, code: "staff_room", detail: `${link.room} is a staff room` };
    if (["OUT_OF_SERVICE", "OUT_OF_ORDER"].includes(room.status)) return { ok: false, status: 409, code: "out_of_use", detail: `Room ${link.room} is out of use` };
    const clash = (await db.query(
      `select occupant_label from room_occupancy where room_id=$1 and group_id is distinct from $2 and on_date >= $3 and on_date < greatest($4::date, $3::date + 1) limit 1`,
      [room.id, args.bookingId, args.arrival, args.departure],
    )).rows[0];
    if (clash) return { ok: false, status: 409, code: "room_taken", detail: `Room ${link.room} is already held for another stay` };
    ready.push({ id: room.id, link });
  }
  for (const row of ready) {
    await db.query(
      `insert into room_occupancy(tenant_id, room_id, group_id, person_id, occupant_label, on_date, slot)
       select $1,$2,$3,$4,$5,d::date,s
       from generate_series($6::date, greatest($7::date - 1, $6::date), interval '1 day') d
       cross join (values ('AM'),('PM')) v(s)
       on conflict do nothing`,
      [args.tenantId, row.id, args.bookingId, row.link.personId, row.link.label, args.arrival, args.departure],
    );
  }
  return { ok: true, placed: plan };
}

export function notesFor(kind: "submitted" | "accepted" | "amended" | "cancelled", stay: StayCapture, rules: RoutingRules, houseName: string): OutboundNote[] {
  if (kind === "cancelled") return cancellationEmails(stay, rules, houseName);
  return bookingEmails(stay, rules, houseName, kind);
}

export function staffEnquiryView(row: Parameters<typeof enquiryInput>[0]) {
  const { capture, loss } = captureFromStored(enquiryInput(row));
  const kitchen = kitchenSlice(capture);
  return {
    party_summary: dietarySummary(capture),
    accept_warning: acceptWarning(loss),
    severe: !!kitchen?.severe,
    access_summary: accessSummary(capture),
  };
}

export { validateCapture, captureFromStored, acceptWarning };

export default async function bookingRouteRoutes(f: FastifyInstance) {
  f.get("/v1/settings/booking-routing", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    if (!a.perms.has("package.manage") && !a.perms.has("config.manage")) return reply.code(403).send(problem(403, "forbidden", "You cannot change house settings"));
    const rules = await loadRoutingRules(pool, a.propertyId);
    return {
      rules,
      receives: {
        kitchen: "Allergens and diets with severity, per person and per day. Severe and anaphylaxis are marked first.",
        restaurant: "Covers per meal, special-diet counts, who needs a prepared plate or table service, and seating help.",
        front: "Arrival time, room preference, accessibility and guest notes. Not the allergen list.",
        housekeeping: "Access codes only: step-free, ground floor, shower, grab rails, quiet room, assistance dog, hearing loop, mobility aid storage, and help with luggage. Not the allergen list. A free-text note is marked for review.",
      },
    };
  });

  f.put<{ Body: unknown }>("/v1/settings/booking-routing", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "package.manage", reply)) return;
    const rules = parseRoutingRules(req.body ?? {});
    await saveRoutingRules(pool, a.propertyId, rules);
    return { rules };
  });
}
