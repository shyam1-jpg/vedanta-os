import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { pool, tx } from './db.ts';
import { requireGuest } from './guestPortal.ts';
import { requireActor, allow, problem } from './auth.ts';
import { parseUuid } from '../../../domains/ops/tasks.ts';
import { arrivalPolicy } from '../../../domains/guest/arrival.ts';

const STAY = `select e.id,e.tenant_id,e.property_id,e.status,e.arrival_date::text arrival,e.departure_date::text departure,
  e.dietary_notes,e.accessibility_notes,e.arrival_time_note,e.travel_notes,e.people,
  b.status booking_status,(timezone('Europe/London',now()))::date::text today
  from guest_enquiry e left join booking_group b on b.id=e.booking_id and b.property_id=e.property_id`;
function detailsHash(stay: any) {
  return createHash('sha256').update(JSON.stringify([stay.arrival,stay.departure,stay.people,
    stay.dietary_notes ?? '',stay.accessibility_notes ?? '',stay.arrival_time_note ?? '',stay.travel_notes ?? ''])).digest('hex');
}
async function state(db: any, stay: any) {
  const r = (await db.query(`select details_hash,details_confirmed_at,arrived_at,reception_seen_at
    from guest_arrival_registration where enquiry_id=$1 and property_id=$2 and stay_arrival=$3 and stay_departure=$4`,
    [stay.id,stay.property_id,stay.arrival,stay.departure])).rows[0];
  const confirmed = !!r && r.details_hash === detailsHash(stay);
  return { ...arrivalPolicy(stay, stay.today, confirmed), today: stay.today, details_version:detailsHash(stay),
    details:{arrival:stay.arrival,departure:stay.departure,people:stay.people,arrival_time:stay.arrival_time_note??'',dietary:stay.dietary_notes??'',accessibility:stay.accessibility_notes??'',travel:stay.travel_notes??''},
    details_confirmed_at: confirmed ? r.details_confirmed_at : null,
    arrived_at: r?.arrived_at ?? null, reception_seen_at: r?.reception_seen_at ?? null };
}

export default async function guestArrival(f: FastifyInstance) {
  f.get('/guest/enquiries/:id/arrival', async (req: any, reply) => {
    reply.header('cache-control','no-store');
    const g = await requireGuest(req,reply); if (!g) return;
    if (!parseUuid(req.params.id)) return reply.code(404).send(problem(404,'not_found','Stay not found'));
    const stay = (await pool.query(`${STAY} where e.id=$1 and e.guest_id=$2 and e.property_id=$3`,[req.params.id,g.id,g.propertyId])).rows[0];
    if (!stay) return reply.code(404).send(problem(404,'not_found','Stay not found'));
    return state(pool,stay);
  });
  f.post('/guest/enquiries/:id/arrival', async (req: any, reply) => {
    reply.header('cache-control','no-store');
    const g = await requireGuest(req,reply); if (!g) return;
    const action = req.body?.action;
    if (!parseUuid(req.params.id) || !['confirm_details','arrive'].includes(action) || req.body?.confirmed !== true)
      return reply.code(422).send(problem(422,'validation','Confirm the arrival action before continuing.'));
    return tx(async c => {
      // Serializes retries and coordinates with the existing stay-details editor.
      const stay = (await c.query(`${STAY} where e.id=$1 and e.guest_id=$2 and e.property_id=$3 for update of e`,[req.params.id,g.id,g.propertyId])).rows[0];
      if (!stay) return reply.code(404).send(problem(404,'not_found','Stay not found'));
      const before = await state(c,stay);
      if (action === 'confirm_details') {
        if (!before.can_confirm) return reply.code(409).send(problem(409,'arrival_unavailable',before.reason));
        if (req.body?.details_version !== before.details_version)
          return reply.code(409).send(problem(409,'details_changed','Your stay details have changed. Refresh arrival status and review them again.'));
        await c.query(`insert into guest_arrival_registration(enquiry_id,tenant_id,property_id,stay_arrival,stay_departure,details_hash)
          values($1,$2,$3,$4,$5,$6) on conflict(enquiry_id) do update set
          details_hash=excluded.details_hash,
          details_confirmed_at=case when guest_arrival_registration.details_hash=excluded.details_hash then guest_arrival_registration.details_confirmed_at else now() end,
          arrived_at=case when guest_arrival_registration.stay_arrival=excluded.stay_arrival and guest_arrival_registration.stay_departure=excluded.stay_departure then guest_arrival_registration.arrived_at end,
          reception_seen_at=case when guest_arrival_registration.stay_arrival=excluded.stay_arrival and guest_arrival_registration.stay_departure=excluded.stay_departure then guest_arrival_registration.reception_seen_at end,
          reception_seen_by=case when guest_arrival_registration.stay_arrival=excluded.stay_arrival and guest_arrival_registration.stay_departure=excluded.stay_departure then guest_arrival_registration.reception_seen_by end,
          stay_arrival=excluded.stay_arrival,stay_departure=excluded.stay_departure`,[stay.id,stay.tenant_id,stay.property_id,stay.arrival,stay.departure,detailsHash(stay)]);
      } else {
        if (!before.can_arrive) return reply.code(409).send(problem(409,'arrival_unavailable',before.reason));
        await c.query(`update guest_arrival_registration set arrived_at=coalesce(arrived_at,now()) where enquiry_id=$1 and property_id=$2`,[stay.id,g.propertyId]);
      }
      return state(c,stay);
    });
  });

  f.get('/v1/ops/morning', async (req,reply) => {
    reply.header('cache-control','no-store');
    const a = await requireActor(req,reply,['ADMIN','STAFF']); if (!a || !allow(a,'group.read',reply)) return;
    const date = (await pool.query(`select (timezone('Europe/London',now()))::date::text today`)).rows[0].today;
    const [groups,rooms,guests] = await Promise.all([
      pool.query(`select id,name,expected_guests,arrival_date::text arrival,departure_date::text departure,to_char(arrival_time,'HH24:MI') arrival_time
        from booking_group where property_id=$1 and status in ('CONFIRMED','IN_HOUSE') and (arrival_date=$2 or departure_date=$2) order by arrival_time nulls last,name`,[a.propertyId,date]),
      pool.query(`select status,count(*)::int count from room where property_id=$1 and not staff_only group by status`,[a.propertyId]),
      // Private detail fields are used only to validate the review fingerprint, then discarded.
      pool.query(`select e.id,e.name,e.people,e.arrival_date::text arrival,e.departure_date::text departure,e.arrival_time_note,
          e.dietary_notes,e.accessibility_notes,e.travel_notes,ar.details_hash,ar.details_confirmed_at,ar.arrived_at,ar.reception_seen_at,
          coalesce((select jsonb_agg(x) from (select distinct r.number,r.status from room_occupancy o join room r on r.id=o.room_id
            where o.group_id=e.booking_id and o.on_date=$2 and r.property_id=$1 and not r.staff_only) x),'[]'::jsonb) rooms
        from guest_enquiry e join booking_group b on b.id=e.booking_id and b.property_id=e.property_id
        left join guest_arrival_registration ar on ar.enquiry_id=e.id and ar.property_id=e.property_id and ar.stay_arrival=e.arrival_date and ar.stay_departure=e.departure_date
        where e.property_id=$1 and e.status='CONVERTED' and b.status in ('CONFIRMED','IN_HOUSE')
          and e.arrival_date<=$2 and e.departure_date>=$2
          and (e.arrival_date=$2 or ar.arrived_at is not null and ar.reception_seen_at is null)
        order by (ar.arrived_at is not null and ar.reception_seen_at is null) desc,e.name`,[a.propertyId,date]),
    ]);
    return {date,arrivals:groups.rows.filter(g=>g.arrival===date),departures:groups.rows.filter(g=>g.departure===date),rooms:rooms.rows,
      guests:guests.rows.map(g=>({id:g.id,name:g.name,people:g.people,arrival:g.arrival,departure:g.departure,arrival_time_note:g.arrival_time_note,
        details_confirmed_at:g.details_hash===detailsHash(g)?g.details_confirmed_at:null,arrived_at:g.arrived_at,reception_seen_at:g.reception_seen_at,rooms:g.rooms})),
      can_acknowledge:a.perms.has('group.update')};
  });
  f.post('/v1/ops/arrivals/:id/acknowledge', async (req: any,reply) => {
    const a = await requireActor(req,reply,['ADMIN','STAFF']); if (!a || !allow(a,'group.read',reply) || !allow(a,'group.update',reply)) return;
    if (!parseUuid(req.params.id)) return reply.code(422).send(problem(422,'validation','Invalid arrival'));
    const result = await pool.query(`update guest_arrival_registration ar set reception_seen_at=coalesce(ar.reception_seen_at,now()),reception_seen_by=coalesce(ar.reception_seen_by,$3)
      from guest_enquiry e join booking_group b on b.id=e.booking_id and b.property_id=e.property_id
      where ar.enquiry_id=$1 and ar.property_id=$2 and e.id=ar.enquiry_id and e.property_id=$2
        and e.status='CONVERTED' and b.status in ('CONFIRMED','IN_HOUSE') and ar.arrived_at is not null
        and ar.stay_arrival=e.arrival_date and ar.stay_departure=e.departure_date
        and e.departure_date>=(timezone('Europe/London',now()))::date returning ar.enquiry_id`,[req.params.id,a.propertyId,a.userId]);
    if (!result.rowCount) return reply.code(409).send(problem(409,'arrival_unavailable','This arrival is no longer available. Refresh the board.'));
    return {ok:true};
  });
}
