/**
 * Staff view for the day before an existing retreat.
 * Reads records. Does not assign rooms, plan meals, fill a rota, or place an order.
 */
import type { FastifyInstance } from "fastify";
import { pool } from "./db.ts";
import { requireActor, allow, problem } from "./auth.ts";
import { parseUuid } from "../../../domains/ops/tasks.ts";
import { preRetreatReadiness, type SafetyRow } from "../../../domains/retreat/pre-retreat.ts";

const NOTE = "Each line stays open until a real record exists. This screen does not assign a room, plan a meal, fill the rota, place an order, or sign off safety.";

export default async function preRetreat(f: FastifyInstance) {
  f.get("/v1/pre-retreat", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "group.read", reply)) return;
    const r = await pool.query(`
      select id, name, status,
             arrival_date::text arrival,
             departure_date::text departure,
             (arrival_date - 1)::text day_before,
             (arrival_date - 1) = (timezone('Europe/London', now()))::date as day_before_is_today
      from booking_group
      where property_id = $1
        and status in ('PROVISIONAL', 'CONFIRMED', 'IN_HOUSE')
        and departure_date >= (timezone('Europe/London', now()))::date - 1
      order by arrival_date, name
      limit 80`, [a.propertyId]);
    return { note: NOTE, items: r.rows };
  });

  f.get("/v1/pre-retreat/:id", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "group.read", reply)) return;
    if (!parseUuid(req.params.id)) return reply.code(422).send(problem(422, "validation", "Invalid booking"));
    const g = (await pool.query(`
      select id, name, status, arrival_date::text arrival, departure_date::text departure
      from booking_group where id = $1 and property_id = $2`, [req.params.id, a.propertyId])).rows[0];
    if (!g) return reply.code(404).send(problem(404, "not_found", "No such retreat"));

    const [rooms, meals, rota, purchases, safety] = await Promise.all([
      pool.query(`select count(distinct o.room_id)::int n
        from room_occupancy o join room r on r.id = o.room_id
        where o.group_id = $1 and r.property_id = $2`, [g.id, a.propertyId]),
      pool.query(`select distinct (p.arrival + i.day_offset)::text meal_date
        from programme_item i join programme p on p.id = i.programme_id
        where p.property_id = $1 and p.group_id = $2
          and i.kind = 'meal' and btrim(i.title) <> ''
          and (p.arrival + i.day_offset) between $3::date and $4::date`, [a.propertyId, g.id, g.arrival, g.departure]),
      pool.query(`select distinct shift_date::text d
        from rota_shift
        where property_id = $1 and status <> 'cancelled' and shift_date between $2::date and $3::date`, [a.propertyId, g.arrival, g.departure]),
      pool.query(`select status, booking_id from purchase_requisition where property_id = $1 and booking_id = $2
        union all
        select status, booking_id from purchase_order where property_id = $1 and booking_id = $2`, [a.propertyId, g.id]),
      pool.query(`select kind, body, signed_at
        from retreat_safety_record where property_id = $1 and booking_id = $2`, [a.propertyId, g.id]),
    ]);

    const safetyRows: SafetyRow[] = safety.rows.map((row: { kind: string; body: string | null; signed_at: string | null }) => ({
      kind: row.kind,
      body: row.body,
      signedAt: row.signed_at ? new Date(row.signed_at).toISOString() : null,
    }));
    const view = preRetreatReadiness({
      bookingId: g.id,
      arrival: g.arrival,
      departure: g.departure,
      roomAssignments: rooms.rows[0]?.n ?? 0,
      mealDates: meals.rows.map((row: { meal_date: string }) => row.meal_date),
      rotaDates: rota.rows.map((row: { d: string }) => row.d),
      purchases: purchases.rows.map((row: { status: string; booking_id: string | null }) => ({ status: row.status, bookingId: row.booking_id })),
      safetyRows,
    });
    return {
      note: NOTE,
      booking: g,
      day_before: view.dayBefore,
      lines: view.lines,
      safety_parts: view.safetyParts,
      ready: view.ready,
    };
  });
}
