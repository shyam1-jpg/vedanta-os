/**
 * Planday-style workforce. Publishing the rota and broadcasting stay with the
 * owner and the general manager. Heads of department approve their own department.
 * Everyone else manages their own availability, leave, swaps and clock.
 */
import type { FastifyInstance } from "fastify";
import { pool } from "./db.ts";
import { requireActor, problem, type Actor } from "./auth.ts";
import { sanitizeRichText } from "../../../domains/ops/suite.ts";
import { mayApproveDepartment, mayBroadcast, mayPublishRota, maySendMessage, shiftHours, suggestOpenShifts } from "../../../domains/ops/workforce.ts";
import { sendEmail } from "./email.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEPTS = ["HOUSE", "FRONT", "NIGHT", "HK", "KITCHEN", "RESTAURANT", "MAINT", "GROUNDS", "MGMT"];

function uuid(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return UUID.test(s) ? s : null;
}
function day(v: unknown): string | null {
  const s = String(v ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function dept(v: unknown): string {
  const s = String(v ?? "").trim().toUpperCase();
  return DEPTS.includes(s) ? s : "";
}
function clockTime(v: unknown): string | null {
  const s = String(v ?? "").slice(0, 5);
  return /^\d{2}:\d{2}$/.test(s) ? s : null;
}

async function reader(req: any, reply: any): Promise<Actor | null> {
  const a = await requireActor(req, reply, ["ADMIN", "STAFF"]);
  if (!a) return null;
  if (a.perms.has("group.read") || a.perms.has("clock.self") || a.perms.has("cover.read") || mayPublishRota(a.perms) || a.perms.has("leave.approve_hod")) return a;
  reply.code(403).send(problem(403, "forbidden", "You cannot open workforce"));
  return null;
}

function flags(a: Actor) {
  return {
    can_publish: mayPublishRota(a.perms),
    can_approve: mayPublishRota(a.perms) || a.perms.has("leave.approve_hod"),
    department: a.department,
  };
}

async function managers(propertyId: string): Promise<Set<string>> {
  const rows = (await pool.query(
    `select distinct m.user_id from membership m
     join role_permission rp on rp.role_id = m.role_id
     where m.property_id = $1 and rp.permission_code in ('content.publish','leave.approve_hod','clock.manage')`,
    [propertyId],
  )).rows;
  return new Set(rows.map((r: { user_id: string }) => r.user_id));
}

async function userDept(propertyId: string, userId: string): Promise<string> {
  const row = (await pool.query(
    `select d.code from membership m left join department d on d.id = m.department_id
     where m.property_id = $1 and m.user_id = $2 limit 1`,
    [propertyId, userId],
  )).rows[0];
  return row?.code ?? "";
}

async function notify(a: Actor, userIds: string[], title: string, body: string) {
  for (const id of userIds) {
    if (id === a.userId) continue;
    const person = (await pool.query(`select email from app_user where id = $1`, [id])).rows[0];
    const pref = (await pool.query(`select digest from wf_digest_pref where user_id = $1`, [id])).rows[0];
    if (person?.email && !pref?.digest) {
      await sendEmail(a, { to: person.email, subject: title, body, kind: "workforce_message" }).catch(() => null);
    }
    await pool.query(`insert into wf_push_outbox (user_id, title, body, status) values ($1,$2,$3,'queued')`, [id, title.slice(0, 140), body.slice(0, 240)]);
  }
}

function parseData(data: string): { mime: string; bytes: Buffer } | null {
  const m = /^data:(application\/pdf|image\/(?:jpeg|png|webp)|text\/plain);base64,([a-z0-9+/=\s]+)$/i.exec(String(data ?? "").trim());
  if (!m) return null;
  const bytes = Buffer.from(m[2].replace(/\s/g, ""), "base64");
  if (!bytes.length || bytes.length > 1_500_000) return null;
  return { mime: m[1].toLowerCase(), bytes };
}

export default async function workforceDesk(f: FastifyInstance) {
  f.get("/v1/workforce-desk", async (req, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const swaps = (await pool.query(
      `select r.id, r.kind, r.note, r.created_at, u.display_name requester, s.department, s.shift_date::text date, s.start_time::text start_time
       from shift_request r join app_user u on u.id = r.requester_id join rota_shift s on s.id = r.shift_id
       where r.property_id = $1 and r.status = 'pending' order by r.created_at desc limit 20`,
      [a.propertyId],
    )).rows;
    const leave = (await pool.query(
      `select id, kind, from_date::text, to_date::text, days, notes, created_at from absence_request
       where property_id = $1 and status = 'pending' order by created_at desc limit 20`,
      [a.propertyId],
    )).rows;
    const punches = (await pool.query(
      `select id, user_id, clocked_in_at, clocked_out_at from clock_record
       where property_id = $1 and approved_at is null and clocked_in_at > now() - interval '14 days'
       order by clocked_in_at desc limit 20`,
      [a.propertyId],
    )).rows;
    const news = (await pool.query(
      `select id, title, body, created_at from ops_news where property_id = $1 order by created_at desc limit 4`,
      [a.propertyId],
    )).rows;
    const events = (await pool.query(
      `select id, title, location, starts_at from ops_appointment
       where property_id = $1 and starts_at >= current_date and starts_at < current_date + 8
       order by starts_at limit 6`,
      [a.propertyId],
    )).rows;
    const birthdays = (await pool.query(
      `select distinct u.id, u.display_name name, u.birthday::text
       from app_user u join membership m on m.user_id = u.id
       where m.property_id = $1 and u.birthday is not null
         and to_char(u.birthday, 'MM-DD') in (select to_char(d::date, 'MM-DD') from generate_series(current_date, current_date + 6, interval '1 day') d)
       order by u.display_name`,
      [a.propertyId],
    )).rows;
    const late = (await pool.query(
      `select s.department, u.display_name name, s.start_time::text start_time
       from rota_shift s join app_user u on u.id = s.user_id
       where s.property_id = $1 and s.published and s.shift_date = current_date and s.user_id is not null
         and (s.start_time + interval '15 minutes') < (current_timestamp at time zone 'UTC')::time
         and not exists (select 1 from clock_record c where c.user_id = s.user_id and c.clocked_in_at::date = current_date)
         and not exists (select 1 from staff_clock c where c.user_id = s.user_id and c.kind = 'IN' and c.at::date = current_date)
       order by s.department, u.display_name`,
      [a.propertyId],
    )).rows;
    const pinned = (await pool.query(
      `select m.id, m.subject from wf_message m join wf_message_target t on t.message_id = m.id
       where t.user_id = $1 and m.require_reply and t.acknowledged_at is null order by m.created_at desc limit 5`,
      [a.userId],
    )).rows;
    return { ...flags(a), swaps, leave, punches, news, events, birthdays, late, pinned };
  });

  f.get("/v1/workforce-desk/schedule", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const from = day(req.query?.from) ?? new Date().toISOString().slice(0, 10);
    const to = day(req.query?.to) ?? from;
    const department = dept(req.query?.department);
    const seeDrafts = mayPublishRota(a.perms) || a.perms.has("leave.approve_hod");
    const params: unknown[] = [a.propertyId, from, to];
    let where = `s.property_id = $1 and s.shift_date between $2::date and $3::date`;
    if (department) { params.push(department); where += ` and s.department = $${params.length}`; }
    if (!seeDrafts) { params.push(a.userId); where += ` and (s.published or s.user_id = $${params.length})`; }
    const shifts = (await pool.query(
      `select s.id, s.user_id, u.display_name name, s.department, s.position, s.shift_type, s.shift_date::text date,
              s.start_time::text start_time, s.end_time::text end_time, s.break_minutes, s.notes, s.published, s.status
       from rota_shift s left join app_user u on u.id = s.user_id
       where ${where} order by s.shift_date, s.start_time`,
      params,
    )).rows.map((row: any) => ({ ...row, hours: shiftHours(row.start_time, row.end_time, row.break_minutes) }));
    const people = (await pool.query(
      `select distinct u.id, u.display_name name, coalesce(d.code, '') department, coalesce(r.name, '') position
       from membership m join app_user u on u.id = m.user_id join role r on r.id = m.role_id
       left join department d on d.id = m.department_id
       where m.property_id = $1 and u.status = 'ACTIVE' order by u.display_name`,
      [a.propertyId],
    )).rows;
    const templates = (await pool.query(
      `select t.id, t.title, t.department from rota_template t where t.property_id = $1 order by t.title`,
      [a.propertyId],
    )).rows;
    return { ...flags(a), from, to, department, shifts, people, templates };
  });

  f.post("/v1/workforce-desk/shifts", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    if (!mayPublishRota(a.perms) && !a.perms.has("leave.approve_hod")) {
      return reply.code(403).send(problem(403, "forbidden", "Heads of department draft the rota. The owner or general manager publishes it."));
    }
    const department = dept(req.body?.department) || a.department || "";
    if (!mayApproveDepartment(a.perms, a.department, department) && !mayPublishRota(a.perms)) {
      return reply.code(403).send(problem(403, "forbidden", "You can draft shifts in your own department."));
    }
    const date = day(req.body?.date);
    const start = clockTime(req.body?.start_time);
    const end = clockTime(req.body?.end_time);
    if (!department || !date || !start || !end) return reply.code(422).send(problem(422, "validation", "Need a department, date and times"));
    const open = !req.body?.user_id;
    const userId = open ? null : uuid(req.body?.user_id);
    if (!open && !userId) return reply.code(422).send(problem(422, "validation", "Choose a person or leave the shift open"));
    const published = mayPublishRota(a.perms) && req.body?.published === true;
    const row = (await pool.query(
      `insert into rota_shift (tenant_id, property_id, user_id, department, position, shift_type, shift_date, start_time, end_time, break_minutes, notes, published, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
      [a.tenantId, a.propertyId, userId, department, String(req.body?.position ?? "").slice(0, 80), open ? "open" : "shift", date, start, end, Number(req.body?.break_minutes) || 30, String(req.body?.notes ?? "").slice(0, 400), published, a.userId],
    )).rows[0];
    reply.code(201);
    return { id: row.id, published };
  });

  f.post("/v1/workforce-desk/shifts/publish", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    if (!mayPublishRota(a.perms)) return reply.code(403).send(problem(403, "forbidden", "Only the owner or a general manager publishes the rota."));
    const from = day(req.body?.from);
    const to = day(req.body?.to);
    if (!from || !to) return reply.code(422).send(problem(422, "validation", "Choose the week to publish"));
    const department = dept(req.body?.department);
    const r = await pool.query(
      `update rota_shift set published = true, status = 'confirmed'
       where property_id = $1 and shift_date between $2::date and $3::date and ($4 = '' or department = $4)`,
      [a.propertyId, from, to, department],
    );
    return { published: r.rowCount };
  });

  f.post("/v1/workforce-desk/shifts/suggest", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    if (!mayPublishRota(a.perms) && !a.perms.has("leave.approve_hod")) return reply.code(403).send(problem(403, "forbidden", "Only a manager can ask for a suggested rota."));
    const from = day(req.body?.from);
    const to = day(req.body?.to);
    if (!from || !to) return reply.code(422).send(problem(422, "validation", "Choose the dates to fill"));
    const department = dept(req.body?.department);
    const open = (await pool.query(
      `select id, department, shift_date::text date, start_time::text start_time, end_time::text end_time, break_minutes
       from rota_shift where property_id = $1 and user_id is null and shift_date between $2::date and $3::date
         and ($4 = '' or department = $4)`,
      [a.propertyId, from, to, department],
    )).rows;
    const assigned = (await pool.query(
      `select user_id, shift_date::text date, start_time::text start_time, end_time::text end_time, break_minutes
       from rota_shift where property_id = $1 and user_id is not null and shift_date between $2::date and $3::date`,
      [a.propertyId, from, to],
    )).rows;
    const off = (await pool.query(
      `select user_id, on_date::text date from staff_availability where property_id = $1 and available = false and on_date between $2::date and $3::date`,
      [a.propertyId, from, to],
    )).rows;
    const people = (await pool.query(
      `select distinct u.id, coalesce(d.code, '') department from membership m
       join app_user u on u.id = m.user_id left join department d on d.id = m.department_id
       where m.property_id = $1 and u.status = 'ACTIVE'`,
      [a.propertyId],
    )).rows;
    const hours = new Map<string, number>();
    for (const row of assigned) hours.set(row.user_id, (hours.get(row.user_id) ?? 0) + shiftHours(row.start_time, row.end_time, row.break_minutes));
    const unavailable = new Map<string, string[]>();
    for (const row of off) unavailable.set(row.user_id, [...(unavailable.get(row.user_id) ?? []), row.date]);
    const placed = suggestOpenShifts(
      open.map((row: any) => ({ id: row.id, department: row.department, date: row.date, hours: shiftHours(row.start_time, row.end_time, row.break_minutes) })),
      people.map((p: any) => ({ id: p.id, department: p.department, hours: hours.get(p.id) ?? 0, unavailable: unavailable.get(p.id) ?? [] })),
    );
    for (const pick of placed) {
      await pool.query(`update rota_shift set user_id = $2, shift_type = 'shift' where id = $1 and property_id = $3 and user_id is null`, [pick.shiftId, pick.userId, a.propertyId]);
    }
    return { suggested: placed.length, skipped: open.length - placed.length };
  });

  f.post("/v1/workforce-desk/templates", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    if (!mayPublishRota(a.perms)) return reply.code(403).send(problem(403, "forbidden", "Only the owner or a general manager saves a rota template."));
    const title = String(req.body?.title ?? "").trim().slice(0, 120);
    const department = dept(req.body?.department);
    if (!title || !department) return reply.code(422).send(problem(422, "validation", "Name the template and its department"));
    const row = (await pool.query(
      `insert into rota_template (tenant_id, property_id, title, department, created_by) values ($1,$2,$3,$4,$5) returning id`,
      [a.tenantId, a.propertyId, title, department, a.userId],
    )).rows[0];
    reply.code(201);
    return { id: row.id };
  });

  f.post("/v1/workforce-desk/templates/:id/apply", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    if (!mayPublishRota(a.perms) && !a.perms.has("leave.approve_hod")) return reply.code(403).send(problem(403, "forbidden", "Only a manager applies a template."));
    const week = day(req.body?.week);
    if (!week) return reply.code(422).send(problem(422, "validation", "Choose the Monday of the week"));
    const template = (await pool.query(`select id, department from rota_template where id = $1 and property_id = $2`, [req.params.id, a.propertyId])).rows[0];
    if (!template) return reply.code(404).send(problem(404, "not_found", "No such template"));
    const lines = (await pool.query(`select weekday, start_time::text, end_time::text, break_minutes, position, notes from rota_template_line where template_id = $1`, [template.id])).rows;
    let made = 0;
    for (const line of lines) {
      await pool.query(
        `insert into rota_shift (tenant_id, property_id, user_id, department, position, shift_type, shift_date, start_time, end_time, break_minutes, notes, published, created_by)
         values ($1,$2,null,$3,$4,'open', $5::date + $6, $7, $8, $9, $10, false, $11)`,
        [a.tenantId, a.propertyId, template.department, line.position, week, line.weekday, line.start_time, line.end_time, line.break_minutes, line.notes, a.userId],
      );
      made += 1;
    }
    reply.code(201);
    return { created: made };
  });

  f.get("/v1/workforce-desk/mine", async (req, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const shifts = (await pool.query(
      `select id, department, position, shift_date::text date, start_time::text start_time, end_time::text end_time, break_minutes, notes, published
       from rota_shift where property_id = $1 and user_id = $2 and shift_date >= current_date - 1 and published
       order by shift_date, start_time limit 21`,
      [a.propertyId, a.userId],
    )).rows;
    const open = (await pool.query(
      `select id, department, position, shift_date::text date, start_time::text start_time, end_time::text end_time, notes
       from rota_shift where property_id = $1 and user_id is null and published and shift_date >= current_date
       order by shift_date limit 12`,
      [a.propertyId],
    )).rows;
    const availability = (await pool.query(
      `select on_date::text date, available, note, locked from staff_availability
       where property_id = $1 and user_id = $2 and on_date between current_date and current_date + 13 order by on_date`,
      [a.propertyId, a.userId],
    )).rows;
    const year = new Date().getFullYear();
    const account = (await pool.query(`select allowance_days, carried_days from leave_account where user_id = $1 and year = $2`, [a.userId, year])).rows[0]
      ?? { allowance_days: 28, carried_days: 0 };
    const used = (await pool.query(
      `select coalesce(sum(days), 0) days from absence_request where user_id = $1 and status = 'approved' and extract(year from from_date) = $2`,
      [a.userId, year],
    )).rows[0];
    const payslips = (await pool.query(
      `select id, period_label, period_start::text, period_end::text, gross_pence, net_pence, summary from payslip where user_id = $1 and property_id = $2 order by period_end desc`,
      [a.userId, a.propertyId],
    )).rows;
    const clock = (await pool.query(
      `select id, clocked_in_at from clock_record where user_id = $1 and clocked_out_at is null order by clocked_in_at desc limit 1`,
      [a.userId],
    )).rows[0] ?? null;
    const pinned = (await pool.query(
      `select m.id, m.subject, m.body_html from wf_message m join wf_message_target t on t.message_id = m.id
       where t.user_id = $1 and m.show_on_clock and t.acknowledged_at is null order by m.created_at desc limit 3`,
      [a.userId],
    )).rows;
    return { shifts, open, availability, leave: { ...account, used_days: Number(used.days) }, payslips, clock, pinned, ...flags(a) };
  });

  f.put("/v1/workforce-desk/availability", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const date = day(req.body?.date);
    if (!date) return reply.code(422).send(problem(422, "validation", "Choose the day"));
    const target = uuid(req.body?.user_id) ?? a.userId;
    if (target !== a.userId && !mayApproveDepartment(a.perms, a.department, await userDept(a.propertyId, target)) && !mayPublishRota(a.perms)) {
      return reply.code(403).send(problem(403, "forbidden", "You can set your own availability."));
    }
    const existing = (await pool.query(`select locked from staff_availability where user_id = $1 and on_date = $2`, [target, date])).rows[0];
    if (existing?.locked && target === a.userId && !mayPublishRota(a.perms)) {
      return reply.code(403).send(problem(403, "forbidden", "A manager has locked this day."));
    }
    const lock = Boolean(req.body?.locked) && (mayPublishRota(a.perms) || a.perms.has("leave.approve_hod"));
    await pool.query(
      `insert into staff_availability (user_id, property_id, on_date, available, note, locked, locked_by)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (user_id, on_date) do update set available = excluded.available, note = excluded.note,
         locked = case when $6 then true else staff_availability.locked end,
         locked_by = case when $6 then $7 else staff_availability.locked_by end`,
      [target, a.propertyId, date, req.body?.available !== false, String(req.body?.note ?? "").slice(0, 240), lock, lock ? a.userId : null],
    );
    return { ok: true };
  });

  f.post("/v1/workforce-desk/swaps", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const shift = uuid(req.body?.shift_id);
    if (!shift) return reply.code(422).send(problem(422, "validation", "Choose the shift"));
    const row = (await pool.query(`select id, user_id, department from rota_shift where id = $1 and property_id = $2 and published`, [shift, a.propertyId])).rows[0];
    if (!row || row.user_id !== a.userId) return reply.code(403).send(problem(403, "forbidden", "You can offer your own shift."));
    const saved = (await pool.query(
      `insert into shift_request (tenant_id, property_id, kind, shift_id, requester_id, counterpart_id, note)
       values ($1,$2,'swap',$3,$4,$5,$6) returning id`,
      [a.tenantId, a.propertyId, shift, a.userId, uuid(req.body?.counterpart_id), String(req.body?.note ?? "").slice(0, 240)],
    )).rows[0];
    reply.code(201);
    return { id: saved.id };
  });

  f.post("/v1/workforce-desk/claims", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const shift = uuid(req.body?.shift_id);
    const row = shift ? (await pool.query(`select id, user_id from rota_shift where id = $1 and property_id = $2 and published`, [shift, a.propertyId])).rows[0] : null;
    if (!row || row.user_id) return reply.code(422).send(problem(422, "validation", "That shift is not open"));
    const saved = (await pool.query(
      `insert into shift_request (tenant_id, property_id, kind, shift_id, requester_id, note) values ($1,$2,'claim',$3,$4,$5) returning id`,
      [a.tenantId, a.propertyId, shift, a.userId, String(req.body?.note ?? "").slice(0, 240)],
    )).rows[0];
    reply.code(201);
    return { id: saved.id };
  });

  f.post("/v1/workforce-desk/requests/:id/decide", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const row = (await pool.query(
      `select r.id, r.kind, r.requester_id, r.status, s.department, s.id shift_id from shift_request r
       join rota_shift s on s.id = r.shift_id where r.id = $1 and r.property_id = $2`,
      [req.params.id, a.propertyId],
    )).rows[0];
    if (!row || row.status !== "pending") return reply.code(404).send(problem(404, "not_found", "No pending request"));
    if (!mayApproveDepartment(a.perms, a.department, row.department)) return reply.code(403).send(problem(403, "forbidden", "A head of that department approves this."));
    const approve = req.body?.approve !== false;
    await pool.query(`update shift_request set status = $2, decided_by = $3, decided_at = now() where id = $1`, [row.id, approve ? "approved" : "declined", a.userId]);
    if (approve) {
      const nextUser = row.kind === "claim" ? row.requester_id : (uuid(req.body?.counterpart_id) ?? row.requester_id);
      if (row.kind === "claim" || uuid(req.body?.counterpart_id)) {
        await pool.query(`update rota_shift set user_id = $2, status = 'swapped' where id = $1`, [row.shift_id, row.kind === "claim" ? row.requester_id : nextUser]);
      }
    }
    return { ok: true };
  });

  f.post("/v1/workforce-desk/leave", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const from = day(req.body?.from);
    const to = day(req.body?.to);
    if (!from || !to) return reply.code(422).send(problem(422, "validation", "Choose the dates"));
    const forUser = uuid(req.body?.user_id);
    const target = forUser && forUser !== a.userId ? forUser : a.userId;
    if (target !== a.userId && !mayApproveDepartment(a.perms, a.department, await userDept(a.propertyId, target)) && !mayPublishRota(a.perms)) {
      return reply.code(403).send(problem(403, "forbidden", "You register your own leave. A manager can register it for you."));
    }
    const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1);
    const status = target !== a.userId && (mayPublishRota(a.perms) || a.perms.has("leave.approve_hod")) && req.body?.approve === true ? "approved" : "pending";
    const row = (await pool.query(
      `insert into absence_request (tenant_id, property_id, user_id, kind, from_date, to_date, days, notes, status, approved_by, approved_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, case when $9 = 'approved' then now() else null end) returning id`,
      [a.tenantId, a.propertyId, target, String(req.body?.kind ?? "holiday").slice(0, 40), from, to, days, String(req.body?.note ?? "").slice(0, 400), status, status === "approved" ? a.userId : null],
    )).rows[0];
    reply.code(201);
    return { id: row.id, status };
  });

  f.post("/v1/workforce-desk/leave/:id/decide", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const row = (await pool.query(`select id, user_id, status from absence_request where id = $1 and property_id = $2`, [req.params.id, a.propertyId])).rows[0];
    if (!row || row.status !== "pending") return reply.code(404).send(problem(404, "not_found", "No pending leave"));
    if (!mayApproveDepartment(a.perms, a.department, await userDept(a.propertyId, row.user_id))) {
      return reply.code(403).send(problem(403, "forbidden", "A head of that department approves this leave."));
    }
    const approve = req.body?.approve !== false;
    await pool.query(
      `update absence_request set status = $2, approved_by = $3, approved_at = now(), decline_reason = $4 where id = $1`,
      [row.id, approve ? "approved" : "declined", a.userId, approve ? null : String(req.body?.reason ?? "").slice(0, 240)],
    );
    return { ok: true };
  });

  f.get("/v1/workforce-desk/leave", async (req, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const manage = mayPublishRota(a.perms) || a.perms.has("leave.approve_hod") || a.perms.has("clock.manage");
    const items = (await pool.query(
      `select a.id, a.kind, a.from_date::text, a.to_date::text, a.days, a.status, a.notes, u.display_name name, a.user_id
       from absence_request a join app_user u on u.id = a.user_id
       where a.property_id = $1 and ($2::boolean or a.user_id = $3)
       order by a.from_date desc limit 80`,
      [a.propertyId, manage, a.userId],
    )).rows;
    const accounts = (await pool.query(
      `select la.user_id, u.display_name name, la.allowance_days, la.carried_days, la.year,
              coalesce((select sum(days) from absence_request ar where ar.user_id = la.user_id and ar.status = 'approved' and extract(year from ar.from_date) = la.year), 0) used_days
       from leave_account la join app_user u on u.id = la.user_id
       where la.property_id = $1 and ($2::boolean or la.user_id = $3)
       order by u.display_name`,
      [a.propertyId, manage, a.userId],
    )).rows;
    return { items, accounts, ...flags(a) };
  });

  f.get("/v1/workforce-desk/leave/export", async (req, reply) => {
    const a = await reader(req, reply); if (!a) return;
    if (!mayPublishRota(a.perms) && !a.perms.has("leave.approve_hod") && !a.perms.has("clock.manage")) {
      return reply.code(403).send(problem(403, "forbidden", "Managers export the leave register."));
    }
    const rows = (await pool.query(
      `select u.display_name, a.kind, a.from_date::text, a.to_date::text, a.days, a.status
       from absence_request a join app_user u on u.id = a.user_id where a.property_id = $1 order by a.from_date`,
      [a.propertyId],
    )).rows;
    const csv = ["name,kind,from,to,days,status", ...rows.map((r: any) => [r.display_name, r.kind, r.from_date, r.to_date, r.days, r.status].map(v => `"${String(v ?? "").replace(/"/g, "")}"`).join(","))].join("\n");
    reply.header("content-type", "text/csv").header("content-disposition", "attachment; filename=\"leave.csv\"");
    return reply.send(csv);
  });

  f.post("/v1/workforce-desk/clock", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    if (!a.perms.has("clock.self") && !mayPublishRota(a.perms)) return reply.code(403).send(problem(403, "forbidden", "Clock in on your own phone."));
    const kind = req.body?.kind === "OUT" ? "OUT" : "IN";
    const open = (await pool.query(`select id from clock_record where user_id = $1 and clocked_out_at is null`, [a.userId])).rows[0];
    if (kind === "IN" && open) return reply.code(409).send(problem(409, "clock", "You are already clocked in"));
    if (kind === "OUT" && !open) return reply.code(409).send(problem(409, "clock", "Clock in first"));
    await pool.query(`insert into staff_clock (tenant_id, property_id, user_id, kind) values ($1,$2,$3,$4)`, [a.tenantId, a.propertyId, a.userId, kind]);
    if (kind === "IN") {
      const row = (await pool.query(
        `insert into clock_record (tenant_id, property_id, user_id) values ($1,$2,$3) returning id, clocked_in_at`,
        [a.tenantId, a.propertyId, a.userId],
      )).rows[0];
      reply.code(201);
      return row;
    }
    const row = (await pool.query(`update clock_record set clocked_out_at = now() where id = $1 returning id, clocked_in_at, clocked_out_at`, [open.id])).rows[0];
    return row;
  });

  f.get("/v1/workforce-desk/timesheets", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const from = day(req.query?.from) ?? new Date().toISOString().slice(0, 10);
    const to = day(req.query?.to) ?? from;
    const manage = mayPublishRota(a.perms) || a.perms.has("clock.manage") || a.perms.has("leave.approve_hod");
    const shifts = (await pool.query(
      `select s.id, s.user_id, u.display_name name, s.department, s.shift_date::text date, s.start_time::text start_time, s.end_time::text end_time, s.break_minutes
       from rota_shift s join app_user u on u.id = s.user_id
       where s.property_id = $1 and s.published and s.user_id is not null and s.shift_date between $2::date and $3::date
         and ($4::boolean or s.user_id = $5)
       order by s.shift_date, u.display_name`,
      [a.propertyId, from, to, manage, a.userId],
    )).rows;
    const punches = (await pool.query(
      `select id, user_id, clocked_in_at, clocked_out_at, break_minutes, approved_at
       from clock_record where property_id = $1 and clocked_in_at::date between $2::date and $3::date`,
      [a.propertyId, from, to],
    )).rows;
    const lines = shifts.map((s: any) => {
      const punch = punches.find((p: any) => p.user_id === s.user_id && new Date(p.clocked_in_at).toISOString().slice(0, 10) === s.date);
      const end = punch ? new Date(punch.clocked_out_at ?? Date.now()) : null;
      const punched = punch && end ? Math.max(0, (end.getTime() - new Date(punch.clocked_in_at).getTime()) / 3600000 - (punch.break_minutes || 0) / 60) : 0;
      return { ...s, scheduled: shiftHours(s.start_time, s.end_time, s.break_minutes), punched: Math.round(punched * 10) / 10, punch_id: punch?.id ?? null, still_in: Boolean(punch && !punch.clocked_out_at), approved: Boolean(punch?.approved_at) };
    });
    return { from, to, lines, ...flags(a) };
  });

  f.post("/v1/workforce-desk/timesheets/:id/approve", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const row = (await pool.query(
      `select c.id, c.user_id from clock_record c where c.id = $1 and c.property_id = $2`,
      [req.params.id, a.propertyId],
    )).rows[0];
    if (!row) return reply.code(404).send(problem(404, "not_found", "No punch to approve"));
    if (!mayApproveDepartment(a.perms, a.department, await userDept(a.propertyId, row.user_id)) && !a.perms.has("clock.manage")) {
      return reply.code(403).send(problem(403, "forbidden", "A manager approves timesheets."));
    }
    await pool.query(`update clock_record set approved_by = $2, approved_at = now() where id = $1`, [row.id, a.userId]);
    return { ok: true };
  });

  f.get("/v1/workforce-desk/people", async (req, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const people = (await pool.query(
      `select distinct u.id, u.display_name name, u.email, u.birthday::text, r.name role_name, coalesce(d.code,'') department, coalesce(d.name,'') department_name,
              h.designation, h.contracted_hours
       from membership m join app_user u on u.id = m.user_id join role r on r.id = m.role_id
       left join department d on d.id = m.department_id
       left join staff_hr h on h.user_id = u.id
       where m.property_id = $1 and u.status = 'ACTIVE' order by department, name`,
      [a.propertyId],
    )).rows;
    const documents = (await pool.query(
      `select id, user_id, kind, title, expires_at::text from staff_document where property_id = $1 order by created_at desc`,
      [a.propertyId],
    )).rows;
    return { people, documents, ...flags(a) };
  });

  f.get("/v1/workforce-desk/reports", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    if (!mayPublishRota(a.perms) && !a.perms.has("clock.manage") && !a.perms.has("leave.approve_hod")) {
      return reply.code(403).send(problem(403, "forbidden", "Workforce reports are for managers."));
    }
    const from = day(req.query?.from) ?? new Date().toISOString().slice(0, 10);
    const to = day(req.query?.to) ?? from;
    const shifts = (await pool.query(
      `select department, shift_type, start_time::text start_time, end_time::text end_time, break_minutes
       from rota_shift where property_id = $1 and published and shift_date between $2::date and $3::date`,
      [a.propertyId, from, to],
    )).rows;
    const byDept = new Map<string, { shifts: number; hours: number }>();
    const byType = new Map<string, number>();
    let scheduled = 0;
    for (const row of shifts) {
      const hours = shiftHours(row.start_time, row.end_time, row.break_minutes);
      scheduled += hours;
      const cur = byDept.get(row.department) ?? { shifts: 0, hours: 0 };
      byDept.set(row.department, { shifts: cur.shifts + 1, hours: Math.round((cur.hours + hours) * 10) / 10 });
      byType.set(row.shift_type, (byType.get(row.shift_type) ?? 0) + 1);
    }
    const punches = (await pool.query(
      `select clocked_in_at, clocked_out_at, approved_at from clock_record
       where property_id = $1 and clocked_in_at::date between $2::date and $3::date`,
      [a.propertyId, from, to],
    )).rows;
    let punched = 0; let approved = 0;
    for (const row of punches) {
      if (!row.clocked_out_at) continue;
      const hours = (new Date(row.clocked_out_at).getTime() - new Date(row.clocked_in_at).getTime()) / 3600000;
      punched += hours;
      if (row.approved_at) approved += hours;
    }
    return {
      from, to,
      schedule: [...byDept.entries()].map(([department, v]) => ({ department, ...v })),
      shift_types: [...byType.entries()].map(([shift_type, count]) => ({ shift_type, count })),
      timesheet: { scheduled: Math.round(scheduled * 10) / 10, punched: Math.round(punched * 10) / 10, approved: Math.round(approved * 10) / 10 },
      labour: { scheduled_hours: Math.round(scheduled * 10) / 10, cost_pence: Math.round(scheduled * 1200), rate_pence: 1200, revenue_note: "Labour cost uses £12 an hour. Revenue stays on Finance." },
    };
  });

  f.get("/v1/workforce-desk/messages", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const box = String(req.query?.box ?? "inbox");
    const q = String(req.query?.q ?? "").trim().slice(0, 80);
    const folder = String(req.query?.folder ?? "").trim().slice(0, 40);
    const params: unknown[] = [a.propertyId, a.userId];
    let where = `m.property_id = $1 and m.parent_id is null`;
    if (box === "sent") where += ` and m.author_user_id = $2`;
    else where += ` and exists (select 1 from wf_message_target t where t.message_id = m.id and t.user_id = $2${folder ? ` and t.folder = $3` : ""})`;
    if (folder && box !== "sent") params.push(folder);
    if (q) { params.push(`%${q.replace(/[%_]/g, "")}%`); where += ` and (m.subject ilike $${params.length} or m.body_html ilike $${params.length})`; }
    const items = (await pool.query(
      `select m.id, m.subject, m.body_html, m.require_reply, m.created_at, m.author_user_id, u.display_name author,
              (select read_at from wf_message_target t where t.message_id = m.id and t.user_id = $2) read_at,
              (select acknowledged_at from wf_message_target t where t.message_id = m.id and t.user_id = $2) acknowledged_at
       from wf_message m left join app_user u on u.id = m.author_user_id
       where ${where} order by m.created_at desc limit 40`,
      params,
    )).rows;
    return { items, ...flags(a) };
  });

  f.get("/v1/workforce-desk/messages/:id", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const root = (await pool.query(
      `select m.id, m.subject, m.body_html, m.require_reply, m.show_on_clock, m.author_user_id, m.created_at, u.display_name author
       from wf_message m left join app_user u on u.id = m.author_user_id
       where m.id = $1 and m.property_id = $2`,
      [req.params.id, a.propertyId],
    )).rows[0];
    if (!root) return reply.code(404).send(problem(404, "not_found", "No such message"));
    const involved = root.author_user_id === a.userId || (await pool.query(`select 1 from wf_message_target where message_id = $1 and user_id = $2`, [root.id, a.userId])).rowCount;
    if (!involved && !mayPublishRota(a.perms)) return reply.code(403).send(problem(403, "forbidden", "That message is not yours"));
    if (root.author_user_id !== a.userId) {
      await pool.query(`update wf_message_target set read_at = coalesce(read_at, now()) where message_id = $1 and user_id = $2`, [root.id, a.userId]);
    }
    const thread = (await pool.query(
      `select m.id, m.body_html, m.created_at, m.author_user_id, u.display_name author
       from wf_message m left join app_user u on u.id = m.author_user_id
       where m.id = $1 or m.parent_id = $1 order by m.created_at`,
      [root.id],
    )).rows;
    const receipts = (await pool.query(
      `select u.display_name name, t.read_at, t.acknowledged_at from wf_message_target t join app_user u on u.id = t.user_id
       where t.message_id = $1 and t.folder <> 'sent' order by u.display_name`,
      [root.id],
    )).rows;
    const files = (await pool.query(`select id, filename from wf_message_file where message_id = $1`, [root.id])).rows;
    return { ...root, thread, receipts, files, can_see_receipts: root.author_user_id === a.userId || mayPublishRota(a.perms) };
  });

  f.post("/v1/workforce-desk/messages", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const parent = uuid(req.body?.parent_id);
    const subject = String(req.body?.subject ?? "").trim().slice(0, 180);
    const body = sanitizeRichText(String(req.body?.body_html ?? req.body?.body ?? ""));
    if (!body.replace(/<[^>]+>/g, "").trim()) return reply.code(422).send(problem(422, "validation", "Write the message"));
    const broadcast = Boolean(req.body?.department || req.body?.everyone);
    const explicit = (Array.isArray(req.body?.recipient_ids) ? req.body.recipient_ids : []).map(uuid).filter((x: string | null): x is string => !!x);
    let replyOk = false;
    if (parent) {
      const root = (await pool.query(`select id, author_user_id from wf_message where id = $1 and property_id = $2`, [parent, a.propertyId])).rows[0];
      const onThread = root && (root.author_user_id === a.userId || (await pool.query(`select 1 from wf_message_target where message_id = $1 and user_id = $2`, [root.id, a.userId])).rowCount);
      if (!onThread) return reply.code(403).send(problem(403, "forbidden", "You can reply on your own threads."));
      replyOk = true;
    }
    const bosses = await managers(a.propertyId);
    const allowed = maySendMessage(a.perms, { broadcast, reply: replyOk, targetsAreManagers: explicit.length > 0 && explicit.every((id: string) => bosses.has(id)) });
    if (!allowed) return reply.code(403).send(problem(403, "forbidden", "You can message a manager or reply. Broadcasting is for the owner or general manager."));
    let recipients = explicit;
    if (broadcast && mayBroadcast(a.perms)) {
      const department = dept(req.body?.department);
      const rows = (await pool.query(
        `select distinct m.user_id from membership m left join department d on d.id = m.department_id
         where m.property_id = $1 and ($2 = '' or d.code = $2)`,
        [a.propertyId, req.body?.everyone ? "" : department],
      )).rows;
      recipients = rows.map((r: { user_id: string }) => r.user_id);
    }
    recipients = [...new Set(recipients)].filter(id => id !== a.userId);
    if (!parent && !recipients.length) return reply.code(422).send(problem(422, "validation", "Choose who receives this"));
    const row = (await pool.query(
      `insert into wf_message (tenant_id, property_id, author_user_id, subject, body_html, require_reply, show_on_clock, parent_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [a.tenantId, a.propertyId, a.userId, parent ? "" : (subject || "Message"), body, !parent && Boolean(req.body?.require_reply) && mayBroadcast(a.perms), !parent && Boolean(req.body?.show_on_clock) && mayBroadcast(a.perms), parent],
    )).rows[0];
    const rootId = parent ?? row.id;
    if (!parent) {
      for (const id of recipients) {
        await pool.query(`insert into wf_message_target (message_id, user_id, folder) values ($1,$2,'inbox') on conflict do nothing`, [row.id, id]);
      }
      await notify(a, recipients, subject || "Message from the house", body.replace(/<[^>]+>/g, " ").trim().slice(0, 500));
    } else {
      const rootAuthor = (await pool.query(`select author_user_id from wf_message where id = $1`, [parent])).rows[0]?.author_user_id;
      const others = (await pool.query(`select user_id from wf_message_target where message_id = $1`, [parent])).rows.map((r: { user_id: string }) => r.user_id);
      await notify(a, [rootAuthor, ...others].filter(Boolean), "Reply on the house thread", body.replace(/<[^>]+>/g, " ").trim().slice(0, 500));
    }
    reply.code(201);
    return { id: rootId };
  });

  f.post("/v1/workforce-desk/messages/:id/ack", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    await pool.query(`update wf_message_target set acknowledged_at = coalesce(acknowledged_at, now()), read_at = coalesce(read_at, now()) where message_id = $1 and user_id = $2`, [req.params.id, a.userId]);
    return { ok: true };
  });

  f.post("/v1/workforce-desk/messages/:id/file", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const folder = String(req.body?.folder ?? "inbox").trim().slice(0, 40) || "inbox";
    await pool.query(`update wf_message_target set folder = $3 where message_id = $1 and user_id = $2`, [req.params.id, a.userId, folder]);
    return { ok: true };
  });

  f.post("/v1/workforce-desk/messages/:id/files", { bodyLimit: 2_000_000 }, async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const message = (await pool.query(`select id, author_user_id from wf_message where id = $1 and property_id = $2`, [req.params.id, a.propertyId])).rows[0];
    if (!message || message.author_user_id !== a.userId) return reply.code(403).send(problem(403, "forbidden", "You attach files to messages you send."));
    const file = parseData(String(req.body?.data ?? ""));
    if (!file) return reply.code(422).send(problem(422, "validation", "Attach a PDF, text file or image under 1.5 MB"));
    const saved = (await pool.query(
      `insert into wf_message_file (message_id, filename, mime, bytes) values ($1,$2,$3,$4) returning id`,
      [message.id, String(req.body?.filename ?? "file").slice(0, 140), file.mime, file.bytes],
    )).rows[0];
    reply.code(201);
    return { id: saved.id };
  });

  f.get("/v1/workforce-files/:id", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const row = (await pool.query(
      `select f.filename, f.mime, f.bytes from wf_message_file f
       join wf_message m on m.id = f.message_id where f.id = $1 and m.property_id = $2`,
      [req.params.id, a.propertyId],
    )).rows[0];
    if (!row) return reply.code(404).send(problem(404, "not_found", "No such file"));
    reply.header("content-type", row.mime).header("content-disposition", `attachment; filename="${String(row.filename).replace(/"/g, "")}"`);
    return reply.send(row.bytes);
  });

  f.post("/v1/workforce-desk/push", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const endpoint = String(req.body?.endpoint ?? "").trim();
    if (!endpoint.startsWith("https://")) return reply.code(422).send(problem(422, "validation", "A push endpoint has to be https"));
    await pool.query(
      `insert into wf_push (user_id, endpoint, p256dh, auth_key) values ($1,$2,$3,$4)
       on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth_key = excluded.auth_key`,
      [a.userId, endpoint.slice(0, 500), String(req.body?.p256dh ?? "").slice(0, 200), String(req.body?.auth ?? "").slice(0, 200)],
    );
    return { ok: true, delivery: process.env.VAPID_PUBLIC_KEY ? "vapid" : "queued" };
  });

  f.post("/v1/workforce-desk/digest", async (req, reply) => {
    const a = await reader(req, reply); if (!a) return;
    await pool.query(`insert into wf_digest_pref (user_id, digest) values ($1, true) on conflict (user_id) do update set digest = true`, [a.userId]);
    const unread = (await pool.query(
      `select m.subject from wf_message m join wf_message_target t on t.message_id = m.id
       where t.user_id = $1 and t.read_at is null order by m.created_at desc limit 20`,
      [a.userId],
    )).rows;
    const body = unread.length ? unread.map((r: { subject: string }) => `• ${r.subject}`).join("\n") : "Nothing unread.";
    const sent = await sendEmail(a, { to: a.email, subject: "Your workforce digest", body, kind: "workforce_digest" });
    return { unread: unread.length, email: sent.status };
  });

  f.post("/v1/workforce-desk/sms", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    if (!mayBroadcast(a.perms)) return reply.code(403).send(problem(403, "forbidden", "Only the owner or a general manager can text the house."));
    const to = String(req.body?.to ?? "").trim().slice(0, 20);
    const body = String(req.body?.body ?? "").trim().slice(0, 320);
    if (!to || !body) return reply.code(422).send(problem(422, "validation", "Need a number and a message"));
    const row = (await pool.query(
      `insert into wf_sms_hook (property_id, to_phone, body, status) values ($1,$2,$3,'stub') returning id`,
      [a.propertyId, to, body],
    )).rows[0];
    return { id: row.id, status: "stub" };
  });
}
