/** Seva rosters on the stay link, the organiser list, the pocket, and the morning briefing. */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { pool } from "./db.ts";
import { requireActor, allow, problem } from "./auth.ts";
import { openStayLink } from "./journey.ts";
import {
  bookSeva,
  cancelSeva,
  generateDailySlots,
  guestAnimals,
  kitchenTasks,
  parseSevaSafety,
  seedActivities,
  seedAnimals,
  sevaAnimalForSlot,
  sevaBriefingText,
  sevaSlotForGuest,
  welcomeSevaLines,
  type SevaActivity,
  type SevaAnimal,
  type SevaBooking,
  type SevaKind,
  type SevaSlot,
} from "../../../domains/ops/seva.ts";

type ActivityRow = {
  id: string; code: string; name: string; kind: SevaKind; description: string; location: string;
  duration_minutes: number; capacity: number; min_age: number; supervisor_role: string; safety_notes: string;
  waiver_required: boolean; waiver_text: string; tasks: string[]; active: boolean;
};

function activityOf(row: ActivityRow): SevaActivity {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    description: row.description,
    location: row.location,
    durationMinutes: row.duration_minutes,
    capacity: row.capacity,
    minAge: row.min_age,
    supervisorRole: row.supervisor_role,
    safetyNotes: row.safety_notes,
    waiverRequired: row.waiver_required,
    waiverText: row.waiver_text,
    tasks: row.tasks ?? [],
    active: row.active,
  };
}

async function safetyFor(propertyId: string) {
  const row = (await pool.query(`select settings from property where id=$1`, [propertyId])).rows[0];
  return parseSevaSafety(row?.settings?.seva);
}

async function ensureSeed(tenantId: string, propertyId: string) {
  const have = (await pool.query(`select count(*)::int n from seva_activity where property_id=$1`, [propertyId])).rows[0];
  if (!have?.n) {
    for (const activity of seedActivities()) {
      await pool.query(
        `insert into seva_activity (tenant_id, property_id, code, name, kind, description, location, duration_minutes, capacity, min_age, supervisor_role, safety_notes, waiver_required, waiver_text, tasks)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         on conflict (property_id, code) do nothing`,
        [tenantId, propertyId, activity.id, activity.name, activity.kind, activity.description, activity.location, activity.durationMinutes, activity.capacity, activity.minAge, activity.supervisorRole, activity.safetyNotes, activity.waiverRequired, activity.waiverText, activity.tasks],
      );
    }
  }
  const animals = (await pool.query(`select count(*)::int n from seva_animal where property_id=$1`, [propertyId])).rows[0];
  if (!animals?.n) {
    for (const animal of seedAnimals()) {
      try {
        await pool.query(
          `insert into seva_animal (tenant_id, property_id, code, name, audience, note, guest_facing, kind) values ($1,$2,$3,$4,$5,$6,$7,$8)
           on conflict (property_id, code) do nothing`,
          [tenantId, propertyId, animal.id, animal.name, animal.audience, animal.note, animal.guestFacing === true, animal.kind ?? "cow"],
        );
      } catch {
        await pool.query(
          `insert into seva_animal (tenant_id, property_id, code, name, audience, note) values ($1,$2,$3,$4,$5,$6)
           on conflict (property_id, code) do nothing`,
          [tenantId, propertyId, animal.id, animal.name, animal.audience, animal.note],
        );
      }
    }
  }
}

async function loadActivities(propertyId: string): Promise<SevaActivity[]> {
  const rows = (await pool.query(
    `select id, code, name, kind, description, location, duration_minutes, capacity, min_age, supervisor_role, safety_notes, waiver_required, waiver_text, tasks, active
     from seva_activity where property_id=$1 and active order by name`,
    [propertyId],
  )).rows as ActivityRow[];
  return rows.map(activityOf);
}

async function loadAnimals(propertyId: string): Promise<SevaAnimal[]> {
  try {
    const rows = (await pool.query(
      `select code, name, audience, note, guest_facing, kind from seva_animal where property_id=$1 order by name`,
      [propertyId],
    )).rows as { code: string; name: string; audience: "guest" | "staff"; note: string; guest_facing: boolean; kind: "cow" | "bull" | null }[];
    return rows.map(row => ({
      id: row.code,
      name: row.name,
      audience: row.kind === "bull" || row.guest_facing === false ? "staff" : row.audience,
      note: row.note,
      guestFacing: row.kind === "bull" ? false : row.guest_facing === true,
      kind: row.kind === "bull" ? "bull" : "cow",
    }));
  } catch {
    const rows = (await pool.query(`select code, name, audience, note from seva_animal where property_id=$1 order by name`, [propertyId])).rows;
    return rows.map((row: { code: string; name: string; audience: "guest" | "staff"; note: string }) => ({
      id: row.code,
      name: row.name,
      audience: row.audience,
      note: row.note,
      guestFacing: row.audience === "guest",
      kind: row.audience === "staff" ? "bull" as const : "cow" as const,
    }));
  }
}

function slotOf(row: { id: string; activity_id: string; date: string; start_time: string; end_time: string; capacity: number; supervisor_name: string | null; animal_code?: string | null }): SevaSlot {
  return {
    id: row.id,
    activityId: row.activity_id,
    date: row.date,
    start: row.start_time,
    end: row.end_time,
    capacity: row.capacity,
    supervisorName: row.supervisor_name,
    animalId: row.animal_code ?? null,
  };
}

async function loadSlots(propertyId: string, from: string, to: string): Promise<SevaSlot[]> {
  try {
    const rows = (await pool.query(
      `select id, activity_id, on_date::text date, start_time, end_time, capacity, supervisor_name, animal_code
       from seva_slot where property_id=$1 and on_date between $2::date and $3::date order by on_date, start_time`,
      [propertyId, from, to],
    )).rows;
    return rows.map(slotOf);
  } catch {
    const rows = (await pool.query(
      `select id, activity_id, on_date::text date, start_time, end_time, capacity, supervisor_name
       from seva_slot where property_id=$1 and on_date between $2::date and $3::date order by on_date, start_time`,
      [propertyId, from, to],
    )).rows;
    return rows.map((row: { id: string; activity_id: string; date: string; start_time: string; end_time: string; capacity: number; supervisor_name: string | null }) => slotOf(row));
  }
}

async function loadBookings(propertyId: string, slotIds: string[]): Promise<SevaBooking[]> {
  if (!slotIds.length) return [];
  const rows = (await pool.query(
    `select b.person_key, b.slot_id, b.guest_name, b.status, b.animal_code, s.on_date::text date, s.start_time, s.end_time
     from seva_booking b join seva_slot s on s.id=b.slot_id
     where b.property_id=$1 and b.slot_id = any($2::uuid[])`,
    [propertyId, slotIds],
  )).rows;
  return rows.map((row: { person_key: string; slot_id: string; guest_name: string; status: "booked" | "waitlist" | "cancelled"; animal_code: string | null; date: string; start_time: string; end_time: string }) => ({
    personKey: row.person_key, slotId: row.slot_id, firstName: row.guest_name, status: row.status, date: row.date, start: row.start_time, end: row.end_time, animalId: row.animal_code,
  }));
}

export async function sevaForStay(scope: { propertyId: string; personId: string; from: string; to: string }) {
  const activities = await loadActivities(scope.propertyId);
  const allAnimals = await loadAnimals(scope.propertyId);
  const animals = guestAnimals(allAnimals);
  const slots = (await loadSlots(scope.propertyId, scope.from, scope.to)).filter(slot => sevaSlotForGuest(slot.animalId, allAnimals));
  const bookings = await loadBookings(scope.propertyId, slots.map(slot => slot.id));
  const safety = await safetyFor(scope.propertyId);
  return {
    slots: slots.map(slot => {
      const activity = activities.find(item => item.id === slot.activityId);
      return {
        id: slot.id,
        name: activity?.name ?? "Seva",
        kind: activity?.kind ?? "other",
        date: slot.date,
        start: slot.start,
        end: slot.end,
        location: activity?.location ?? "",
        safety: activity?.safetyNotes ?? "",
        tasks: activity ? kitchenTasks(activity, safety) : [],
        waiver: activity?.waiverText ?? "",
        waiver_required: !!activity?.waiverRequired,
        bookable: !!slot.supervisorName,
        label: activity ? sevaBriefingText(activity, slot, bookings) : "unsupervised: not bookable",
        animals: activity?.kind === "cow_care" ? animals : [],
      };
    }),
    mine: bookings.filter(row => row.personKey === scope.personId && row.status !== "cancelled").map(row => ({
      slot_id: row.slotId, status: row.status,
    })),
    welcome: welcomeSevaLines(activities, slots, bookings, scope.personId),
  };
}

export async function sevaBriefing(propertyId: string, date: string) {
  const activities = await loadActivities(propertyId);
  const slots = await loadSlots(propertyId, date, date);
  const bookings = await loadBookings(propertyId, slots.map(slot => slot.id));
  return slots.map(slot => {
    const activity = activities.find(item => item.id === slot.activityId);
    return { id: slot.id, text: activity ? sevaBriefingText(activity, slot, bookings) : `${slot.start} · unsupervised: not bookable` };
  });
}

async function organiserSession(req: FastifyRequest, reply: FastifyReply) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    reply.code(401).send(problem(401, "unauthenticated", "Sign in to continue"));
    return null;
  }
  const row = (await pool.query(
    `select tenant_id, property_id, group_ids from organiser_session where token=$1 and expires_at > now()`,
    [auth.slice(7)],
  )).rows[0];
  if (!row) {
    reply.code(401).send(problem(401, "unauthenticated", "Sign in to continue"));
    return null;
  }
  return { tenantId: row.tenant_id as string, propertyId: row.property_id as string, groupIds: row.group_ids as string[] };
}

export default async function sevaRoutes(f: FastifyInstance) {
  f.get("/v1/seva", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "group.read", reply)) return;
    await ensureSeed(a.tenantId, a.propertyId);
    const clock = (await pool.query(`select to_char(timezone('Europe/London', now()), 'YYYY-MM-DD') date`)).rows[0];
    const safety = await safetyFor(a.propertyId);
    const activities = await loadActivities(a.propertyId);
    const animals = await loadAnimals(a.propertyId);
    const slots = await loadSlots(a.propertyId, clock.date, clock.date);
    const bookings = await loadBookings(a.propertyId, slots.map(slot => slot.id));
    return {
      safety,
      activities: activities.map(activity => ({ ...activity, tasks: kitchenTasks(activity, safety) })),
      animals,
      slots: slots.map(slot => {
        const activity = activities.find(item => item.id === slot.activityId);
        const people = bookings.filter(row => row.slotId === slot.id && row.status !== "cancelled");
        return {
          ...slot,
          name: activity?.name ?? "Seva",
          label: activity ? sevaBriefingText(activity, slot, bookings) : "unsupervised: not bookable",
          roster: people.map(row => ({ name: row.firstName, status: row.status })),
        };
      }),
    };
  });

  f.put("/v1/seva/safety", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "group.update", reply)) return;
    const safety = parseSevaSafety(req.body ?? {});
    await pool.query(
      `update property set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{seva}', $2::jsonb, true) where id=$1`,
      [a.propertyId, JSON.stringify({
        guests_visit_cows_with_staff: safety.guestsVisitCowsWithStaff,
        kitchen_food_handling: safety.kitchenFoodHandling,
        hygiene_briefing_required: safety.hygieneBriefingRequired,
      })],
    );
    return safety;
  });

  f.post("/v1/seva/slots", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "group.update", reply)) return;
    await ensureSeed(a.tenantId, a.propertyId);
    const activity = (await pool.query(`select * from seva_activity where property_id=$1 and (id::text=$2 or code=$2)`, [a.propertyId, String(req.body?.activity_id ?? "")])).rows[0] as ActivityRow | undefined;
    if (!activity) return reply.code(404).send(problem(404, "not_found", "That activity is not on the list"));
    const animals = await loadAnimals(a.propertyId);
    const linked = sevaAnimalForSlot(activity.kind, animals, req.body?.animal_id ? String(req.body.animal_id) : null);
    if (!linked.ok) return reply.code(422).send(problem(422, "validation", linked.error));
    const made = generateDailySlots({
      activityId: activity.id,
      from: String(req.body?.from ?? ""),
      to: String(req.body?.to ?? ""),
      start: String(req.body?.start ?? "09:00"),
      durationMinutes: activity.duration_minutes,
      capacity: activity.capacity,
    });
    if (!made.length) return reply.code(422).send(problem(422, "validation", "Choose the dates for these slots"));
    for (const slot of made) {
      try {
        await pool.query(
          `insert into seva_slot (tenant_id, property_id, activity_id, on_date, start_time, end_time, capacity, animal_code)
           values ($1,$2,$3,$4::date,$5,$6,$7,$8)
           on conflict (activity_id, on_date, start_time) do update set animal_code = coalesce(excluded.animal_code, seva_slot.animal_code)`,
          [a.tenantId, a.propertyId, activity.id, slot.date, slot.start, slot.end, slot.capacity, linked.animalId],
        );
      } catch {
        await pool.query(
          `insert into seva_slot (tenant_id, property_id, activity_id, on_date, start_time, end_time, capacity)
           values ($1,$2,$3,$4::date,$5,$6,$7)
           on conflict (activity_id, on_date, start_time) do nothing`,
          [a.tenantId, a.propertyId, activity.id, slot.date, slot.start, slot.end, slot.capacity],
        );
      }
    }
    return { created: made.length };
  });

  f.post<{ Params: { id: string } }>("/v1/seva/slots/:id/animal", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "group.update", reply)) return;
    const slot = (await pool.query(
      `select s.id, a.kind from seva_slot s join seva_activity a on a.id = s.activity_id where s.id=$1 and s.property_id=$2`,
      [req.params.id, a.propertyId],
    )).rows[0] as { id: string; kind: string } | undefined;
    if (!slot) return reply.code(404).send(problem(404, "not_found", "That slot is not on the list"));
    const linked = sevaAnimalForSlot(slot.kind, await loadAnimals(a.propertyId), req.body?.animal_id ? String(req.body.animal_id) : null);
    if (!linked.ok) return reply.code(422).send(problem(422, "validation", linked.error));
    try {
      await pool.query(`update seva_slot set animal_code=$3 where id=$1 and property_id=$2`, [slot.id, a.propertyId, linked.animalId]);
    } catch {
      return reply.code(503).send(problem(503, "unavailable", "Cow care is not ready yet"));
    }
    return { ok: true, animal_id: linked.animalId };
  });

  f.post<{ Params: { id: string } }>("/v1/seva/slots/:id/supervisor", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "group.update", reply)) return;
    const name = String(req.body?.name ?? "").trim().slice(0, 80);
    const saved = await pool.query(`update seva_slot set supervisor_name=$3 where id=$1 and property_id=$2`, [req.params.id, a.propertyId, name || null]);
    if (!saved.rowCount) return reply.code(404).send(problem(404, "not_found", "That slot is not on the list"));
    return { ok: true, bookable: !!name, label: name ? name : "unsupervised: not bookable" };
  });

  f.post<{ Params: { token: string } }>("/public/journey/:token/seva", async (req: any, reply) => {
    const found = await openStayLink(req.params.token);
    if (!found.ok) return reply.code(found.status).send(problem(found.status, "not_found", found.error));
    const slotSql = `select s.id slot_id, s.activity_id, s.on_date::text date, s.start_time, s.end_time, s.capacity slot_capacity, s.supervisor_name,
              a.id, a.code, a.name, a.kind, a.description, a.location, a.duration_minutes, a.capacity, a.min_age, a.supervisor_role,
              a.safety_notes, a.waiver_required, a.waiver_text, a.tasks, a.active`;
    let slotRow: any;
    try {
      slotRow = (await pool.query(
        `${slotSql}, s.animal_code from seva_slot s join seva_activity a on a.id=s.activity_id where s.id=$1 and s.property_id=$2`,
        [req.body?.slot_id, found.row.property_id],
      )).rows[0];
    } catch {
      slotRow = (await pool.query(
        `${slotSql} from seva_slot s join seva_activity a on a.id=s.activity_id where s.id=$1 and s.property_id=$2`,
        [req.body?.slot_id, found.row.property_id],
      )).rows[0];
      if (slotRow) slotRow.animal_code = null;
    }
    if (!slotRow) return reply.code(404).send(problem(404, "not_found", "That slot is not on the list"));
    if (slotRow.date < found.row.arrival || slotRow.date > found.row.departure) {
      return reply.code(422).send(problem(422, "validation", "That slot is not during your stay"));
    }
    const animals = await loadAnimals(found.row.property_id);
    const mine = await loadBookings(found.row.property_id, (await loadSlots(found.row.property_id, found.row.arrival, found.row.departure)).map(slot => slot.id));
    const decision = bookSeva({
      personKey: found.row.person_id,
      firstName: found.row.given_name || "Guest",
      age: req.body?.age == null || req.body?.age === "" ? null : Number(req.body.age),
      slot: { id: slotRow.slot_id, activityId: slotRow.activity_id, date: slotRow.date, start: slotRow.start_time, end: slotRow.end_time, capacity: slotRow.slot_capacity, supervisorName: slotRow.supervisor_name, animalId: slotRow.animal_code ?? null },
      activity: activityOf(slotRow),
      animals,
      chosenAnimalId: req.body?.animal_id ? String(req.body.animal_id) : null,
      existing: mine,
      waiverAck: !!req.body?.waiver_ack,
      hygieneAck: !!req.body?.hygiene_ack,
      safety: await safetyFor(found.row.property_id),
    });
    if (!decision.ok) return reply.code(422).send(problem(422, "validation", decision.error));
    await pool.query(
      `insert into seva_booking (tenant_id, property_id, slot_id, person_id, person_key, guest_name, status, animal_code)
       values ($1,$2,$3,$4,$4,$5,$6,$7)
       on conflict (slot_id, person_key) do update set status=excluded.status, animal_code=excluded.animal_code, guest_name=excluded.guest_name`,
      [found.row.tenant_id, found.row.property_id, slotRow.slot_id, found.row.person_id, found.row.given_name || "Guest", decision.status, decision.animalId],
    );
    return { ok: true, status: decision.status };
  });

  f.post<{ Params: { token: string } }>("/public/journey/:token/seva/cancel", async (req: any, reply) => {
    const found = await openStayLink(req.params.token);
    if (!found.ok) return reply.code(found.status).send(problem(found.status, "not_found", found.error));
    const slots = await loadSlots(found.row.property_id, found.row.arrival, found.row.departure);
    const existing = await loadBookings(found.row.property_id, slots.map(slot => slot.id));
    const next = cancelSeva(existing, found.row.person_id, String(req.body?.slot_id ?? ""));
    await pool.query(
      `update seva_booking set status='cancelled' where slot_id=$1 and person_key=$2 and property_id=$3`,
      [req.body?.slot_id, found.row.person_id, found.row.property_id],
    );
    if (next.promoted) {
      await pool.query(
        `update seva_booking set status='booked' where slot_id=$1 and person_key=$2 and status='waitlist'`,
        [req.body?.slot_id, next.promoted],
      );
    }
    return { ok: true, promoted: !!next.promoted };
  });

  f.get("/public/organiser/seva", async (req, reply) => {
    const session = await organiserSession(req, reply); if (!session) return;
    const rows = (await pool.query(
      `select a.name activity, s.on_date::text date, s.start_time, b.guest_name, b.status, g.name group_name
       from seva_booking b
       join seva_slot s on s.id=b.slot_id
       join seva_activity a on a.id=s.activity_id
       join group_attendee ga on ga.person_id=b.person_id
       join booking_group g on g.id=ga.group_id
       where b.property_id=$1 and ga.group_id = any($2::uuid[]) and b.status <> 'cancelled'
       order by s.on_date, s.start_time, b.guest_name`,
      [session.propertyId, session.groupIds],
    )).rows;
    return { items: rows };
  });
}
