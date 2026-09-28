/** Shuttle plans. Guests give a train time on the stay link. Staff confirm the clustered runs. */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { pool } from "./db.ts";
import { requireActor, allow, problem } from "./auth.ts";
import { openStayLink } from "./journey.ts";
import {
  guestPickup,
  lateTrain,
  manifest,
  markSeat,
  moveSeat,
  organiserShuttles,
  proposeRuns,
  seedShuttle,
  shuttleLetter,
  type ShuttleRun,
  type ShuttleSeat,
  type TravelRequest,
} from "../../../domains/ops/transport.ts";

type ServiceRow = {
  id: string; code: string; name: string; route: string; capacity: number; driver: string;
  travel_minutes: number; meeting_point: string; window_minutes: number;
};

async function ensureService(tenantId: string, propertyId: string): Promise<ServiceRow> {
  const existing = (await pool.query(`select * from shuttle_service where property_id=$1 order by name limit 1`, [propertyId])).rows[0] as ServiceRow | undefined;
  if (existing) return existing;
  const seed = seedShuttle();
  const row = (await pool.query(
    `insert into shuttle_service (tenant_id, property_id, code, name, route, capacity, driver, travel_minutes, meeting_point, window_minutes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [tenantId, propertyId, seed.id, seed.name, seed.route, seed.capacity, seed.driver, seed.travelMinutes, seed.meetingPoint, 45],
  )).rows[0];
  return row;
}

function serviceOf(row: ServiceRow) {
  return {
    id: row.id,
    name: row.name,
    route: row.route,
    capacity: row.capacity,
    driver: row.driver,
    travelMinutes: row.travel_minutes,
    meetingPoint: row.meeting_point,
  };
}

async function runsFor(propertyId: string, date: string): Promise<ShuttleRun[]> {
  const runs = (await pool.query(
    `select id, service_id, direction, on_date::text date, pickup_time, meeting_point, train_from, train_to, confirmed, overflow
     from shuttle_run where property_id=$1 and on_date=$2::date order by pickup_time`,
    [propertyId, date],
  )).rows as { id: string; service_id: string; direction: "arrival" | "departure"; date: string; pickup_time: string; meeting_point: string; train_from: string; train_to: string; confirmed: boolean; overflow: boolean }[];
  if (!runs.length) return [];
  const seats = (await pool.query(
    `select run_id, person_key, guest_name, party, group_id, group_name, access, mark from shuttle_seat where run_id = any($1::uuid[])`,
    [runs.map(run => run.id)],
  )).rows as { run_id: string; person_key: string; guest_name: string; party: number; group_id: string; group_name: string; access: string[]; mark: ShuttleSeat["mark"] }[];
  return runs.map(run => ({
    id: run.id,
    serviceId: run.service_id,
    direction: run.direction,
    date: run.date,
    pickupTime: run.pickup_time,
    meetingPoint: run.meeting_point,
    trainFrom: run.train_from,
    trainTo: run.train_to,
    confirmed: run.confirmed,
    overflow: run.overflow,
    seats: seats.filter(seat => seat.run_id === run.id).map(seat => ({
      personKey: seat.person_key,
      firstName: seat.guest_name,
      party: seat.party,
      groupId: seat.group_id,
      groupName: seat.group_name,
      access: seat.access ?? [],
      mark: seat.mark,
    })),
  }));
}

export async function shuttleForPerson(propertyId: string, personId: string): Promise<string> {
  const seat = (await pool.query(
    `select r.on_date::text date from shuttle_seat s join shuttle_run r on r.id=s.run_id
     where r.property_id=$1 and s.person_key=$2 order by r.on_date limit 1`,
    [propertyId, personId],
  )).rows[0];
  if (!seat) return shuttleLetter(null);
  const runs = await runsFor(propertyId, seat.date);
  return shuttleLetter(guestPickup(runs, personId));
}

async function organiserSession(req: FastifyRequest, reply: FastifyReply) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    reply.code(401).send(problem(401, "unauthenticated", "Sign in to continue"));
    return null;
  }
  const row = (await pool.query(
    `select property_id, group_ids from organiser_session where token=$1 and expires_at > now()`,
    [auth.slice(7)],
  )).rows[0];
  if (!row) {
    reply.code(401).send(problem(401, "unauthenticated", "Sign in to continue"));
    return null;
  }
  return { propertyId: row.property_id as string, groupIds: row.group_ids as string[] };
}

function view(run: ShuttleRun) {
  return { ...run, manifest: manifest(run) };
}

export default async function transportRoutes(f: FastifyInstance) {
  f.get("/v1/shuttles", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "group.read", reply)) return;
    const service = await ensureService(a.tenantId, a.propertyId);
    const date = String(req.query?.date ?? "");
    const clock = date || (await pool.query(`select to_char(timezone('Europe/London', now()), 'YYYY-MM-DD') date`)).rows[0].date;
    const runs = await runsFor(a.propertyId, clock);
    return { service: { ...serviceOf(service), windowMinutes: service.window_minutes }, date: clock, runs: runs.map(view) };
  });

  f.put("/v1/shuttles/service", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "group.update", reply)) return;
    const current = await ensureService(a.tenantId, a.propertyId);
    const body = req.body ?? {};
    await pool.query(
      `update shuttle_service set name=$2, route=$3, capacity=$4, driver=$5, travel_minutes=$6, meeting_point=$7, window_minutes=$8 where id=$1`,
      [
        current.id,
        String(body.name ?? current.name).slice(0, 120),
        String(body.route ?? current.route).slice(0, 200),
        Math.min(40, Math.max(1, Number(body.capacity ?? current.capacity) || current.capacity)),
        String(body.driver ?? current.driver).slice(0, 80),
        Math.min(180, Math.max(5, Number(body.travel_minutes ?? current.travel_minutes) || current.travel_minutes)),
        String(body.meeting_point ?? current.meeting_point).slice(0, 200),
        Math.min(180, Math.max(10, Number(body.window_minutes ?? current.window_minutes) || 45)),
      ],
    );
    return { ok: true };
  });

  f.post("/v1/shuttles/plan", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "group.update", reply)) return;
    const service = await ensureService(a.tenantId, a.propertyId);
    const date = String(req.body?.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply.code(422).send(problem(422, "validation", "Choose the date"));
    const plans = (await pool.query(
      `select person_key, guest_name, party, group_id, group_name, direction, mode, train_time, on_date::text date, access
       from travel_plan where property_id=$1 and on_date=$2::date`,
      [a.propertyId, date],
    )).rows as {
      person_key: string; guest_name: string; party: number; group_id: string; group_name: string;
      direction: TravelRequest["direction"]; mode: TravelRequest["mode"]; train_time: string | null; date: string; access: string[] | null;
    }[];
    const requests: TravelRequest[] = plans.map(row => ({
      personKey: row.person_key,
      firstName: row.guest_name,
      party: row.party,
      groupId: row.group_id,
      groupName: row.group_name,
      direction: row.direction,
      mode: row.mode,
      trainTime: row.train_time,
      date: row.date,
      access: row.access ?? [],
    }));
    const arrival = proposeRuns({ service: serviceOf(service), requests, windowMinutes: service.window_minutes, direction: "arrival", date });
    const departure = proposeRuns({ service: serviceOf(service), requests, windowMinutes: service.window_minutes, direction: "departure", date });
    await pool.query(`delete from shuttle_run where property_id=$1 and on_date=$2::date and confirmed=false`, [a.propertyId, date]);
    for (const run of [...arrival.runs, ...departure.runs]) {
      const saved = (await pool.query(
        `insert into shuttle_run (tenant_id, property_id, service_id, direction, on_date, pickup_time, meeting_point, train_from, train_to, overflow)
         values ($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10) returning id`,
        [a.tenantId, a.propertyId, service.id, run.direction, date, run.pickupTime, run.meetingPoint, run.trainFrom, run.trainTo, run.overflow],
      )).rows[0];
      for (const seat of run.seats) {
        await pool.query(
          `insert into shuttle_seat (run_id, person_key, guest_name, party, group_id, group_name, access) values ($1,$2,$3,$4,$5,$6,$7)`,
          [saved.id, seat.personKey, seat.firstName, seat.party, seat.groupId, seat.groupName, seat.access],
        );
      }
    }
    return { runs: (await runsFor(a.propertyId, date)).map(view), suggestions: [] };
  });

  f.post<{ Params: { id: string } }>("/v1/shuttles/runs/:id/confirm", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "group.update", reply)) return;
    const saved = await pool.query(`update shuttle_run set confirmed=true where id=$1 and property_id=$2`, [req.params.id, a.propertyId]);
    if (!saved.rowCount) return reply.code(404).send(problem(404, "not_found", "That shuttle is not on the list"));
    return { ok: true };
  });

  f.post("/v1/shuttles/move", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "group.update", reply)) return;
    const date = String(req.body?.date ?? "");
    const service = await ensureService(a.tenantId, a.propertyId);
    const current = await runsFor(a.propertyId, date);
    const moved = moveSeat(current, String(req.body?.person_key ?? ""), String(req.body?.run_id ?? ""), service.capacity);
    if (!moved.ok) return reply.code(422).send(problem(422, "validation", moved.error));
    for (const run of moved.runs) {
      await pool.query(`delete from shuttle_seat where run_id=$1`, [run.id]);
      for (const seat of run.seats) {
        await pool.query(
          `insert into shuttle_seat (run_id, person_key, guest_name, party, group_id, group_name, access, mark) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [run.id, seat.personKey, seat.firstName, seat.party, seat.groupId, seat.groupName, seat.access, seat.mark],
        );
      }
    }
    return { ok: true };
  });

  f.post<{ Params: { id: string } }>("/v1/shuttles/runs/:id/mark", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "group.read", reply)) return;
    const mark = req.body?.mark === "no_show" ? "no_show" : "picked_up";
    const runs = await runsFor(a.propertyId, String(req.body?.date ?? ""));
    const run = runs.find(item => item.id === req.params.id) ?? (await (async () => {
      const row = (await pool.query(`select on_date::text date from shuttle_run where id=$1 and property_id=$2`, [req.params.id, a.propertyId])).rows[0];
      if (!row) return null;
      return (await runsFor(a.propertyId, row.date)).find(item => item.id === req.params.id) ?? null;
    })());
    if (!run) return reply.code(404).send(problem(404, "not_found", "That shuttle is not on the list"));
    const next = markSeat(run, String(req.body?.person_key ?? ""), mark);
    if (!next) return reply.code(404).send(problem(404, "not_found", "That guest is not on this shuttle"));
    await pool.query(`update shuttle_seat set mark=$3 where run_id=$1 and person_key=$2`, [run.id, req.body?.person_key, mark]);
    return { ok: true, manifest: manifest(next) };
  });

  f.post<{ Params: { token: string } }>("/public/journey/:token/travel", async (req: any, reply) => {
    const found = await openStayLink(req.params.token);
    if (!found.ok) return reply.code(found.status).send(problem(found.status, "not_found", found.error));
    const direction = req.body?.direction === "departure" ? "departure" : "arrival";
    const mode = ["shuttle", "own_car", "taxi", "lift", "other"].includes(req.body?.mode) ? req.body.mode : "shuttle";
    const train = String(req.body?.train_time ?? "").trim();
    const access = Array.isArray(req.body?.access) ? req.body.access.filter((item: string) => item === "wheelchair" || item === "luggage") : [];
    const onDate = direction === "arrival" ? found.row.arrival : found.row.departure;
    await pool.query(
      `insert into travel_plan (tenant_id, property_id, group_id, person_id, person_key, guest_name, group_name, direction, mode, train_time, party, access, on_date)
       values ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,1,$10,$11::date)
       on conflict (group_id, person_key, direction) do update set mode=excluded.mode, train_time=excluded.train_time, access=excluded.access, on_date=excluded.on_date`,
      [found.row.tenant_id, found.row.property_id, found.row.group_id, found.row.person_id, found.row.given_name || "Guest", found.row.group_name, direction, mode, train || null, access, onDate],
    );
    const runs = await runsFor(found.row.property_id, onDate);
    const mine = runs.find(run => run.seats.some(seat => seat.personKey === found.row.person_id));
    const suggestion = mine && train ? lateTrain(mine, found.row.person_id, train, 45).suggestion : null;
    return { ok: true, suggestion, shuttle: shuttleLetter(guestPickup(runs, found.row.person_id)) };
  });

  f.get("/public/organiser/shuttles", async (req, reply) => {
    const session = await organiserSession(req, reply); if (!session) return;
    const dates = (await pool.query(
      `select distinct on_date::text date from shuttle_run where property_id=$1 and on_date >= timezone('Europe/London', now())::date order by on_date limit 14`,
      [session.propertyId],
    )).rows as { date: string }[];
    const items = [];
    for (const row of dates) {
      const runs = await runsFor(session.propertyId, row.date);
      for (const groupId of session.groupIds) items.push(...organiserShuttles(runs, groupId));
    }
    return { items };
  });
}
