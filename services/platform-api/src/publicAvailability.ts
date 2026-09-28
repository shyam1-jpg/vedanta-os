/**
 * Public year availability for the guest book.
 * One read per year. The body is status and counts — never a person.
 * Cloudflare may cache the response (s-maxage); the browser copy is shorter.
 */
import type { FastifyInstance } from "fastify";
import { pool } from "./db.ts";
import { problem } from "./auth.ts";
import {
  PUBLIC_AVAILABILITY_CACHE,
  allowPublicRead,
  allowedYears,
  buildPublicAvailability,
  londonTodayISO,
  type NightHold,
  type ProgrammeFact,
  type RoomFact,
} from "../../../domains/guest/year-availability.ts";

const hits = new Map<string, { n: number; t: number }>();
const cache = new Map<string, { exp: number; body: unknown }>();
const CACHE_MS = 60_000;

async function propertyId(): Promise<string | null> {
  const row = (await pool.query(`select id from property order by created_at limit 1`)).rows[0];
  return row?.id ?? null;
}

export default async function publicAvailability(f: FastifyInstance) {
  f.get("/public/availability", async (req: any, reply) => {
    const ip = String(req.ip || "x");
    if (!allowPublicRead(hits, `avail:${ip}`)) {
      reply.header("cache-control", "no-store");
      return reply.code(429).send(problem(429, "rate_limited", "Please wait a minute"));
    }

    const year = Number(req.query?.year);
    if (!Number.isInteger(year)) {
      reply.header("cache-control", "no-store");
      return reply.code(422).send(problem(422, "validation", "Choose a year"));
    }
    const bounds = allowedYears(londonTodayISO());
    if (year < bounds.min || year > bounds.max) {
      reply.header("cache-control", "no-store");
      return reply.code(422).send(problem(422, "validation", `Choose a year from ${bounds.min} to ${bounds.max}`));
    }

    const prop = await propertyId();
    if (!prop) {
      reply.header("cache-control", "no-store");
      return reply.code(503).send(problem(503, "unavailable", "The house calendar is not ready"));
    }

    const key = `${prop}:${year}`;
    const hit = cache.get(key);
    if (hit && hit.exp > Date.now()) {
      reply.header("cache-control", PUBLIC_AVAILABILITY_CACHE);
      return hit.body;
    }

    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    const roomsQ = await pool.query(
      `select r.number, t.code as type, t.name as type_name, r.max_capacity as sleeps,
              ('disabled_access' = any(coalesce(r.features, '{}'))) as accessible,
              r.status in ('OUT_OF_SERVICE', 'OUT_OF_ORDER') as blocked
         from room r
         join room_type t on t.id = r.room_type_id
        where r.property_id = $1 and not r.staff_only
        order by t.code, r.number`,
      [prop],
    );
    const nightsQ = await pool.query(
      `select r.number as room,
              (case when o.slot = 'AM' then o.on_date - 1 else o.on_date end)::text as night,
              bool_or(o.group_id is not null) as held
         from room_occupancy o
         join room r on r.id = o.room_id
         left join booking_group g on g.id = o.group_id
        where r.property_id = $1
          and not r.staff_only
          and o.on_date between $2::date and ($3::date + 1)
          and (o.group_id is null or g.status <> 'CANCELLED')
        group by r.number, night`,
      [prop, start, end],
    );
    const programmesQ = await pool.query(
      `select g.id::text, g.name, g.retreat_type,
              g.arrival_date::text as arrival, g.departure_date::text as departure,
              g.expected_guests,
              (select count(*)::int from group_attendee ga where ga.group_id = g.id) as attendees,
              (select coalesce(sum(e.people), 0)::int from guest_enquiry e
                where e.programme_id = g.id and e.status in ('ENQUIRY', 'ACKNOWLEDGED')) as enquiry_people
         from booking_group g
        where g.property_id = $1
          and g.departure_date >= $2::date
          and g.arrival_date <= $3::date
          and g.status in ('PROVISIONAL', 'CONFIRMED', 'IN_HOUSE')
          and g.retreat_type in ('residential', 'day_retreat')
          and coalesce(g.open_for_guests, false) = true
          and g.name not ilike 'HOLD%'
          and g.name not ilike '%booking%'`,
      [prop, start, end],
    );

    const rooms: RoomFact[] = roomsQ.rows.map((row: any) => ({
      number: String(row.number),
      type: String(row.type),
      typeName: row.type_name ?? null,
      sleeps: Number(row.sleeps) || 1,
      accessible: !!row.accessible,
      blocked: !!row.blocked,
    }));
    const nights: NightHold[] = nightsQ.rows.map((row: any) => ({
      room: String(row.room),
      night: String(row.night).slice(0, 10),
      held: !!row.held,
    }));
    const programmes: ProgrammeFact[] = programmesQ.rows.map((row: any) => ({
      id: String(row.id),
      name: String(row.name ?? ""),
      retreat_type: String(row.retreat_type ?? ""),
      arrival: String(row.arrival).slice(0, 10),
      departure: String(row.departure).slice(0, 10),
      expected_guests: row.expected_guests == null ? null : Number(row.expected_guests),
      attendees: Number(row.attendees) || 0,
      enquiry_people: Number(row.enquiry_people) || 0,
    }));

    const body = buildPublicAvailability({ year, rooms, nights, programmes });
    cache.set(key, { exp: Date.now() + CACHE_MS, body });
    reply.header("cache-control", PUBLIC_AVAILABILITY_CACHE);
    return body;
  });
}
