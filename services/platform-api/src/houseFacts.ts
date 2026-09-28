/** Shared house facts for the night audit and the live daily briefing. */
import { pool } from "./db.ts";
import { openText } from "./fieldCrypto.ts";

function opened(value: string | null | undefined): string {
  if (!value) return "";
  try { return openText(value)?.trim() ?? ""; }
  catch { return ""; }
}

async function sectionRows(logAs: string, label: string, sql: string, params: unknown[]) {
  try { return (await pool.query(sql, params)).rows as Record<string, unknown>[]; }
  catch (err) {
    console.error(`[${logAs}] ${label} unavailable`, err instanceof Error ? err.message : err);
    return [];
  }
}

async function sectionCount(logAs: string, label: string, sql: string, params: unknown[]) {
  try { return Number((await pool.query(sql, params)).rows[0]?.n ?? 0); }
  catch (err) {
    console.error(`[${logAs}] ${label} unavailable`, err instanceof Error ? err.message : err);
    return 0;
  }
}

const ROOM_FREE = `not r.staff_only
  and r.status not in ('OUT_OF_SERVICE', 'OUT_OF_ORDER')
  and not exists (
    select 1 from maintenance_ticket t
    where t.room_id = r.id and t.takes_room_out and t.status not in ('DONE', 'CANCELLED')
  )`;

export type HouseScope = {
  propertyId: string;
  stayOn: string;
  roomFrom: string;
  roomTo: string;
  occupancyOn: string;
  paidOn: string;
  ticketOn: string;
  issueOn: string;
  trainingOn: string;
  trainingDays: number;
  complianceOn: string;
  complianceDays: number;
  handoverDates: string[];
  handoverMorning: boolean;
  handoverLimit: number;
  deliveryOn: string;
  includeInHouse: boolean;
  shiftsOn: string | null;
  logAs: string;
};

export type HouseStay = {
  id: string;
  givenName: string | null;
  familyName: string | null;
  groupName: string | null;
  room: string | null;
  party: number | null;
  returning: boolean;
  severe: boolean;
  accessibility: string;
  arrivalDate: string;
  departureDate: string;
  allergens: string[];
  vip: boolean;
  flagged: boolean;
};

export type HouseShift = {
  id: string;
  userId: string;
  department: string;
  displayName: string;
  start: string;
  end: string;
  swapped: boolean;
};

export type HouseFacts = {
  stays: HouseStay[];
  occupiedRooms: number;
  availableRooms: number;
  payments: { kind: string; amount: number; note: string | null }[];
  tickets: { id: string; number: string; title: string; priority: string; status: string; ageDays: number; location: string }[];
  issues: { id: string; label: string; overdue: boolean }[];
  stock: { id: string; name: string; quantity: number; unit: string; low: number }[];
  training: { id: string; name: string; title: string; expiresOn: string }[];
  compliance: { id: string; title: string; dueOn: string }[];
  notes: { id: string; author: string; department: string; shift: string; excerpt: string; ackedBy: string[] }[];
  deliveries: { id: string; supplier: string; detail: string }[];
  shifts: HouseShift[];
  shiftsKnown: boolean;
};

function codes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item ?? "").trim()).filter(Boolean);
}

function first(value: unknown, fallback: string): string {
  const token = String(value ?? "").trim().split(/\s+/).filter(Boolean)[0];
  return token || fallback;
}

export async function loadHouseFacts(scope: HouseScope): Promise<HouseFacts> {
  const logAs = scope.logAs;
  const stayRows = await sectionRows(logAs, "stays", `
    select g.id::text as group_id, g.name as group_name, g.expected_guests,
           g.arrival_date::text as arrival_date, g.departure_date::text as departure_date,
           g.accessibility_notes, p.given_name, p.family_name,
           coalesce(gp.vip, ga.vip, false) as vip,
           coalesce(ga.flagged, false) as flagged,
           (
             select coalesce(array_agg(distinct code), '{}')
             from diet_profile d
             join person ap on ap.id = d.person_id and ap.merged_into_id is null
             cross join lateral unnest(coalesce(d.allergens, '{}')) as code
             where d.person_id = g.organiser_person_id
                or exists (select 1 from group_attendee a where a.group_id = g.id and a.person_id = d.person_id)
           ) as allergens,
           (
             select string_agg(n, ', ' order by n) from (
               select distinct r.number as n
               from room_occupancy o
               join room r on r.id = o.room_id
               where o.group_id = g.id and o.on_date between $2::date and $3::date
             ) rooms
           ) as room,
           exists (
             select 1 from diet_profile d
             join person ap on ap.id = d.person_id and ap.merged_into_id is null
             where (d.severity = 'ANAPHYLAXIS' or coalesce(d.allergen_detail, '') ilike '%anaphylaxis%')
               and (
                 d.person_id = g.organiser_person_id
                 or exists (select 1 from group_attendee a where a.group_id = g.id and a.person_id = d.person_id)
               )
           ) as severe,
           (
             exists (
               select 1 from group_attendee a
               join person ap on ap.id = a.person_id and ap.merged_into_id is null
               join group_attendee prev on prev.person_id = a.person_id and prev.group_id <> g.id
               join booking_group pg on pg.id = prev.group_id and pg.status = 'COMPLETED' and pg.property_id = g.property_id
               where a.group_id = g.id
             )
             or exists (
               select 1 from booking_group prev
               join person op on op.id = prev.organiser_person_id and op.merged_into_id is null
               where prev.property_id = g.property_id and prev.status = 'COMPLETED'
                 and prev.id <> g.id and prev.organiser_person_id = g.organiser_person_id
             )
           ) as returning
    from booking_group g
    left join person p on p.id = g.organiser_person_id and p.merged_into_id is null
    left join guest_profile gp on gp.person_id = p.id
    left join guest_account ga on ga.id = p.guest_account_id
    where g.property_id = $1
      and g.status in ('PROVISIONAL', 'CONFIRMED', 'IN_HOUSE')
      and (
        g.arrival_date = $4::date
        or g.departure_date = $4::date
        or ($5::boolean and g.status = 'IN_HOUSE' and g.arrival_date < $4::date and g.departure_date > $4::date)
      )
  `, [scope.propertyId, scope.roomFrom, scope.roomTo, scope.stayOn, scope.includeInHouse]);

  const stays: HouseStay[] = stayRows.map(row => ({
    id: String(row.group_id),
    givenName: row.given_name as string | null,
    familyName: row.family_name as string | null,
    groupName: row.group_name as string | null,
    room: row.room as string | null,
    party: row.expected_guests as number | null,
    returning: !!row.returning,
    severe: !!row.severe,
    accessibility: opened(row.accessibility_notes as string | null),
    arrivalDate: String(row.arrival_date ?? ""),
    departureDate: String(row.departure_date ?? ""),
    allergens: codes(row.allergens),
    vip: !!row.vip,
    flagged: !!row.flagged,
  }));

  const occupiedRooms = await sectionCount(logAs, "occupied", `
    select count(distinct o.room_id)::int as n
    from room_occupancy o
    join room r on r.id = o.room_id
    join booking_group g on g.id = o.group_id
    where r.property_id = $1 and o.on_date = $2::date
      and g.status not in ('CANCELLED', 'ENQUIRY')
      and ${ROOM_FREE}
  `, [scope.propertyId, scope.occupancyOn]);

  const availableRooms = await sectionCount(logAs, "available", `
    select count(*)::int as n from room r
    where r.property_id = $1 and ${ROOM_FREE}
  `, [scope.propertyId]);

  const payments = (await sectionRows(logAs, "revenue", `
    select p.kind, p.amount, p.note
    from payment p
    join folio f on f.id = p.folio_id
    where f.property_id = $1 and p.paid_at is not null
      and (timezone('Europe/London', p.paid_at))::date = $2::date
  `, [scope.propertyId, scope.paidOn])).map(row => ({
    kind: String(row.kind ?? ""),
    amount: Number(row.amount),
    note: row.note as string | null,
  }));

  const tickets = (await sectionRows(logAs, "maintenance", `
    select t.id::text as id, t.number, t.title, t.priority, t.status,
           (($2::date) - (timezone('Europe/London', t.created_at))::date) as age_days,
           coalesce(r.number, t.location, 'House') as location
    from maintenance_ticket t
    left join room r on r.id = t.room_id
    where t.property_id = $1 and t.status not in ('DONE', 'CANCELLED')
    order by t.created_at
  `, [scope.propertyId, scope.ticketOn])).map(row => ({
    id: String(row.id ?? ""),
    number: `M-${row.number}`,
    title: String(row.title ?? "Ticket"),
    priority: String(row.priority ?? "NORMAL"),
    status: String(row.status ?? "OPEN"),
    ageDays: Number(row.age_days ?? 0),
    location: String(row.location ?? "House"),
  }));

  const issues = (await sectionRows(logAs, "issues", `
    select c.id::text as id, coalesce(f.problem_category, 'other') as label,
           (c.due_on is not null and c.due_on < $2::date) as overdue
    from capa c
    left join guest_feedback f on f.id = c.feedback_id
    where c.property_id = $1 and c.status not in ('closed', 'verified')
    union all
    select gc.id::text, 'complaint', false
    from guest_complaint gc
    where gc.property_id = $1 and gc.resolved_at is null
  `, [scope.propertyId, scope.issueOn])).map(row => ({
    id: String(row.id ?? ""),
    label: String(row.label ?? "other"),
    overdue: !!row.overdue,
  }));

  const stock = (await sectionRows(logAs, "stock", `
    select id::text as id, name, quantity, unit, low_threshold
    from kitchen_stock_item
    where property_id = $1 and active and quantity < low_threshold
    order by name
  `, [scope.propertyId])).map(row => ({
    id: String(row.id ?? ""),
    name: String(row.name),
    quantity: Number(row.quantity),
    unit: String(row.unit ?? ""),
    low: Number(row.low_threshold),
  }));

  const training = (await sectionRows(logAs, "training", `
    select a.id::text as id, u.display_name as name, i.title, a.expires_on::text as expires_on
    from training_assignment a
    join training_item i on i.id = a.item_id
    join app_user u on u.id = a.user_id
    where a.property_id = $1 and i.certificate and a.signed_off_at is not null
      and a.expires_on between $2::date and ($2::date + $3::int)
    order by a.expires_on, u.display_name
  `, [scope.propertyId, scope.trainingOn, scope.trainingDays])).map(row => ({
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    title: String(row.title ?? ""),
    expiresOn: String(row.expires_on),
  }));

  const compliance = (await sectionRows(logAs, "compliance", `
    select id::text as id, title, next_due::text as due_on
    from compliance_item
    where property_id = $1 and active and next_due is not null and next_due <= ($2::date + $3::int)
    order by next_due, title
  `, [scope.propertyId, scope.complianceOn, scope.complianceDays])).map(row => ({
    id: String(row.id ?? ""),
    title: String(row.title),
    dueOn: String(row.due_on),
  }));

  const notes = (await sectionRows(logAs, "handover", `
    select h.id::text as id, h.author_name, h.department, h.shift, h.body,
           coalesce((select array_agg(a.user_id::text) from ops_handover_ack a where a.handover_id = h.id), '{}') as acked
    from ops_handover h
    where h.property_id = $1
      and h.for_date = any($2::date[])
      and (
        $3::boolean = false
        or h.shift = 'night'
        or 'morning' = any(h.tags)
        or upper(h.department) in ('FRONT', 'NIGHT')
      )
    order by h.created_at desc
    limit $4
  `, [scope.propertyId, scope.handoverDates, scope.handoverMorning, scope.handoverLimit])).map(row => ({
    id: String(row.id ?? ""),
    author: String(row.author_name ?? "Staff"),
    department: String(row.department ?? ""),
    shift: String(row.shift ?? ""),
    excerpt: opened(row.body as string | null),
    ackedBy: codes(row.acked),
  }));

  const deliveries = (await sectionRows(logAs, "deliveries", `
    select id::text as id, name, array_to_string(categories, ', ') as detail
    from supplier
    where property_id = $1 and active and next_delivery = $2::date
    order by name
  `, [scope.propertyId, scope.deliveryOn])).map(row => ({
    id: String(row.id ?? ""),
    supplier: String(row.name),
    detail: String(row.detail ?? ""),
  }));

  let shifts: HouseShift[] = [];
  let shiftsKnown = false;
  if (scope.shiftsOn) {
    try {
      const rows = (await pool.query(`
        select s.id::text as id, s.user_id::text as user_id, s.department, u.display_name,
               to_char(s.start_time, 'HH24:MI') as start_time,
               to_char(s.end_time, 'HH24:MI') as end_time,
               (s.status = 'swapped') as swapped
        from rota_shift s
        join app_user u on u.id = s.user_id
        where s.property_id = $1 and s.shift_date = $2::date and s.status <> 'cancelled'
        order by s.department, s.start_time, u.display_name
      `, [scope.propertyId, scope.shiftsOn])).rows as Record<string, unknown>[];
      shiftsKnown = true;
      shifts = rows.map(row => ({
        id: String(row.id),
        userId: String(row.user_id),
        department: String(row.department ?? ""),
        displayName: String(row.display_name ?? ""),
        start: String(row.start_time ?? ""),
        end: String(row.end_time ?? ""),
        swapped: !!row.swapped,
      }));
    } catch (err) {
      console.error(`[${logAs}] shifts unavailable`, err instanceof Error ? err.message : err);
    }
  }

  return {
    stays, occupiedRooms, availableRooms, payments, tickets, issues, stock, training, compliance, notes, deliveries, shifts, shiftsKnown,
  };
}

export function firstName(value: string | null | undefined, fallback = "Guest"): string {
  return first(value, fallback);
}
