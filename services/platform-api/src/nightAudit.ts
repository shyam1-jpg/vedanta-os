/** Night audit snapshots. The 15-minute scheduler writes one row per property per London date. */
import type { FastifyInstance } from "fastify";
import { pool } from "./db.ts";
import { requireActor, allow, problem } from "./auth.ts";
import { sendEmail } from "./email.ts";
import { openText } from "./fieldCrypto.ts";
import { parseFaultRouting } from "../../../domains/ops/fault.ts";
import {
  auditEmail,
  auditShouldRun,
  buildNightAudit,
  parseNightAuditSettings,
  projectStay,
  renderAuditHtml,
  renderAuditPdf,
  resolveGmEmail,
  type NightAuditReport,
  type NightAuditSettings,
} from "../../../domains/ops/nightAudit.ts";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function opened(value: string | null | undefined): string {
  if (!value) return "";
  try { return openText(value)?.trim() ?? ""; }
  catch { return ""; }
}

async function londonClock(): Promise<{ date: string; time: string; tomorrow: string }> {
  const row = (await pool.query(
    `select to_char(timezone('Europe/London', now()), 'YYYY-MM-DD') as date,
            to_char(timezone('Europe/London', now()), 'HH24:MI') as time,
            to_char((timezone('Europe/London', now()))::date + 1, 'YYYY-MM-DD') as tomorrow`,
  )).rows[0];
  return { date: row.date, time: row.time, tomorrow: row.tomorrow };
}

async function propertySettings(propertyId: string) {
  return (await pool.query(`select tenant_id, settings from property where id=$1`, [propertyId])).rows[0] as { tenant_id: string; settings: Record<string, unknown> | null } | undefined;
}

async function loadSettings(propertyId: string): Promise<{ settings: NightAuditSettings; gm: string } | null> {
  const row = await propertySettings(propertyId);
  if (!row) return null;
  const settings = parseNightAuditSettings(row.settings?.night_audit);
  const fault = parseFaultRouting(row.settings?.fault_routing);
  return { settings, gm: resolveGmEmail(settings, fault.manager) };
}

function settingsBody(settings: NightAuditSettings) {
  return { time: settings.time, gm_email: settings.gmEmail, auto_email: settings.autoEmail };
}

async function sectionRows(label: string, sql: string, params: unknown[]) {
  try { return (await pool.query(sql, params)).rows as Record<string, unknown>[]; }
  catch (err) {
    console.error(`[night-audit] ${label} unavailable`, err instanceof Error ? err.message : err);
    return [];
  }
}

async function sectionCount(label: string, sql: string, params: unknown[]) {
  try { return Number((await pool.query(sql, params)).rows[0]?.n ?? 0); }
  catch (err) {
    console.error(`[night-audit] ${label} unavailable`, err instanceof Error ? err.message : err);
    return 0;
  }
}

const ROOM_FREE = `not r.staff_only
  and r.status not in ('OUT_OF_SERVICE', 'OUT_OF_ORDER')
  and not exists (
    select 1 from maintenance_ticket t
    where t.room_id = r.id and t.takes_room_out and t.status not in ('DONE', 'CANCELLED')
  )`;

async function collect(propertyId: string, today: string, tomorrow: string) {
  const stayRows = await sectionRows("stays", `
    select g.name as group_name, g.expected_guests, g.arrival_date::text as arrival_date, g.departure_date::text as departure_date,
           g.accessibility_notes, p.given_name, p.family_name,
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
    where g.property_id = $1
      and g.status in ('PROVISIONAL', 'CONFIRMED', 'IN_HOUSE')
      and (g.arrival_date = $3::date or g.departure_date = $3::date)
  `, [propertyId, today, tomorrow]);

  const stays = [];
  for (const row of stayRows) {
    const access = opened(row.accessibility_notes as string | null);
    const base = {
      givenName: row.given_name as string | null,
      familyName: row.family_name as string | null,
      groupName: row.group_name as string | null,
      room: row.room as string | null,
      party: row.expected_guests as number | null,
      returning: !!row.returning,
      severity: row.severe ? "ANAPHYLAXIS" : null,
      accessibility: access,
    };
    if (row.arrival_date === tomorrow) stays.push(projectStay({ ...base, movement: "arrival" }));
    if (row.departure_date === tomorrow) stays.push(projectStay({ ...base, movement: "departure" }));
  }

  const occupiedRooms = await sectionCount("occupied", `
    select count(distinct o.room_id)::int as n
    from room_occupancy o
    join room r on r.id = o.room_id
    join booking_group g on g.id = o.group_id
    where r.property_id = $1 and o.on_date = $2::date
      and g.status not in ('CANCELLED', 'ENQUIRY')
      and ${ROOM_FREE}
  `, [propertyId, today]);

  const availableRooms = await sectionCount("available", `
    select count(*)::int as n from room r
    where r.property_id = $1 and ${ROOM_FREE}
  `, [propertyId]);

  const payments = (await sectionRows("revenue", `
    select p.kind, p.amount, p.note
    from payment p
    join folio f on f.id = p.folio_id
    where f.property_id = $1 and p.paid_at is not null
      and (timezone('Europe/London', p.paid_at))::date = $2::date
  `, [propertyId, today])).map(row => ({ kind: String(row.kind ?? ""), amount: Number(row.amount), note: row.note as string | null }));

  const tickets = (await sectionRows("maintenance", `
    select t.number, t.title, t.priority, t.status,
           (($2::date) - (timezone('Europe/London', t.created_at))::date) as age_days,
           coalesce(r.number, t.location, 'House') as location
    from maintenance_ticket t
    left join room r on r.id = t.room_id
    where t.property_id = $1 and t.status not in ('DONE', 'CANCELLED')
    order by t.created_at
  `, [propertyId, today])).map(row => ({
    number: `M-${row.number}`,
    title: String(row.title ?? "Ticket"),
    priority: String(row.priority ?? "NORMAL"),
    status: String(row.status ?? "OPEN"),
    ageDays: Number(row.age_days ?? 0),
    location: String(row.location ?? "House"),
  }));

  const issues = (await sectionRows("issues", `
    select coalesce(f.problem_category, 'other') as label,
           (c.due_on is not null and c.due_on < $2::date) as overdue
    from capa c
    left join guest_feedback f on f.id = c.feedback_id
    where c.property_id = $1 and c.status not in ('closed', 'verified')
    union all
    select 'complaint', false
    from guest_complaint gc
    where gc.property_id = $1 and gc.resolved_at is null
  `, [propertyId, today])).map(row => ({ label: String(row.label ?? "other"), overdue: !!row.overdue }));

  const stock = (await sectionRows("stock", `
    select name, quantity, unit, low_threshold
    from kitchen_stock_item
    where property_id = $1 and active and quantity < low_threshold
    order by name
  `, [propertyId])).map(row => ({
    name: String(row.name),
    quantity: Number(row.quantity),
    unit: String(row.unit ?? ""),
    low: Number(row.low_threshold),
  }));

  const training = (await sectionRows("training", `
    select u.display_name as name, i.title, a.expires_on::text as expires_on
    from training_assignment a
    join training_item i on i.id = a.item_id
    join app_user u on u.id = a.user_id
    where a.property_id = $1 and i.certificate and a.signed_off_at is not null
      and a.expires_on between $2::date and ($2::date + 30)
    order by a.expires_on, u.display_name
  `, [propertyId, today])).map(row => ({
    name: String(row.name ?? ""),
    title: String(row.title ?? ""),
    expiresOn: String(row.expires_on),
  }));

  const compliance = (await sectionRows("compliance", `
    select title, next_due::text as due_on
    from compliance_item
    where property_id = $1 and active and next_due is not null and next_due <= ($2::date + 7)
    order by next_due, title
  `, [propertyId, today])).map(row => ({ title: String(row.title), dueOn: String(row.due_on) }));

  const notes = (await sectionRows("handover", `
    select author_name, department, shift, body
    from ops_handover
    where property_id = $1 and for_date in ($2::date, $3::date)
      and (shift = 'night' or 'morning' = any(tags) or upper(department) in ('FRONT', 'NIGHT'))
    order by created_at desc
    limit 12
  `, [propertyId, today, tomorrow])).map(row => ({
    author: String(row.author_name ?? "Staff"),
    department: String(row.department ?? ""),
    shift: String(row.shift ?? ""),
    excerpt: opened(row.body as string | null),
  }));

  const deliveries = (await sectionRows("deliveries", `
    select name, array_to_string(categories, ', ') as detail
    from supplier
    where property_id = $1 and active and next_delivery = $2::date
    order by name
  `, [propertyId, tomorrow])).map(row => ({
    supplier: String(row.name),
    detail: String(row.detail ?? ""),
  }));

  return buildNightAudit({
    auditDate: today,
    tomorrow,
    stays,
    occupiedRooms,
    availableRooms,
    payments,
    tickets,
    issues,
    stock,
    training,
    compliance,
    notes,
    deliveries,
  });
}

async function writeSnapshot(propertyId: string, tenantId: string, report: NightAuditReport, source: "schedule" | "demand", userId: string | null) {
  const html = renderAuditHtml(report);
  const conflict = source === "schedule"
    ? "on conflict (property_id, audit_date) do nothing"
    : `on conflict (property_id, audit_date) do update set
        generated_at = now(), generated_by = excluded.generated_by, source = excluded.source, data = excluded.data, html = excluded.html`;
  const row = (await pool.query(
    `insert into night_audit (tenant_id, property_id, audit_date, generated_by, source, data, html)
     values ($1, $2, $3::date, $4, $5, $6::jsonb, $7)
     ${conflict}
     returning id, audit_date::text as audit_date, emailed_at`,
    [tenantId, propertyId, report.auditDate, userId, source, JSON.stringify(report), html],
  )).rows[0] as { id: string; audit_date: string; emailed_at: string | null } | undefined;
  return row ?? null;
}

async function deliver(propertyId: string, tenantId: string, id: string, report: NightAuditReport, to: string, userId: string | null) {
  const letter = auditEmail(report);
  const sent = await sendEmail(
    { tenantId, propertyId, userId },
    { to, subject: letter.subject, body: letter.body, kind: "night_audit", related_type: "night_audit", related_id: id },
  );
  if (sent.status === "FAILED") throw new Error(sent.error ?? "The night audit email failed");
  await pool.query(`update night_audit set emailed_at = now() where id = $1`, [id]);
  return sent.status;
}

export async function runScheduledNightAudit(propertyId: string): Promise<void> {
  const clock = await londonClock();
  const loaded = await loadSettings(propertyId);
  if (!loaded) return;
  const already = ((await pool.query(`select 1 from night_audit where property_id=$1 and audit_date=$2::date`, [propertyId, clock.date])).rowCount ?? 0) > 0;
  if (!auditShouldRun({ londonTime: clock.time, configured: loaded.settings.time, already })) return;
  const prop = await propertySettings(propertyId);
  if (!prop) return;
  const report = await collect(propertyId, clock.date, clock.tomorrow);
  const saved = await writeSnapshot(propertyId, prop.tenant_id, report, "schedule", null);
  if (!saved || !loaded.settings.autoEmail || saved.emailed_at || !loaded.gm) return;
  await deliver(propertyId, prop.tenant_id, saved.id, report, loaded.gm, null);
}

function asReport(value: unknown): NightAuditReport | null {
  if (!value || typeof value !== "object") return null;
  const report = value as NightAuditReport;
  if (!Array.isArray(report.sections) || !report.auditDate) return null;
  return report;
}

export default async function nightAuditRoutes(f: FastifyInstance) {
  f.get("/v1/settings/night-audit", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a) return;
    if (!a.perms.has("night.audit") && !a.perms.has("package.manage")) {
      return reply.code(403).send(problem(403, "forbidden", "You cannot open night audit settings"));
    }
    const loaded = await loadSettings(a.propertyId);
    if (!loaded) return reply.code(404).send(problem(404, "not_found", "No such property"));
    return settingsBody(loaded.settings);
  });

  f.put("/v1/settings/night-audit", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "package.manage", reply)) return;
    const settings = parseNightAuditSettings(req.body ?? {});
    await pool.query(
      `update property set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{night_audit}', $2::jsonb, true) where id=$1`,
      [a.propertyId, JSON.stringify(settingsBody(settings))],
    );
    return settingsBody(settings);
  });

  f.get("/v1/night-audit", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "night.audit", reply)) return;
    const rows = (await pool.query(
      `select id, audit_date::text as audit_date, generated_at, source, emailed_at, data->'headline' as headline
       from night_audit where property_id=$1 order by audit_date desc limit 90`,
      [a.propertyId],
    )).rows;
    return { items: rows };
  });

  f.post("/v1/night-audit/generate", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "night.audit", reply)) return;
    const clock = await londonClock();
    const report = await collect(a.propertyId, clock.date, clock.tomorrow);
    const saved = await writeSnapshot(a.propertyId, a.tenantId, report, "demand", a.userId);
    if (!saved) return reply.code(500).send(problem(500, "internal", "The night audit could not be saved"));
    return { id: saved.id, audit_date: saved.audit_date, source: "demand", emailed_at: saved.emailed_at, report };
  });

  f.get<{ Params: { date: string } }>("/v1/night-audit/:date/pdf", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "night.audit", reply)) return;
    if (!DATE.test(req.params.date)) return reply.code(422).send(problem(422, "validation", "Use a date like 2026-09-28"));
    const row = (await pool.query(
      `select data from night_audit where property_id=$1 and audit_date=$2::date`,
      [a.propertyId, req.params.date],
    )).rows[0];
    const report = asReport(row?.data);
    if (!report) return reply.code(404).send(problem(404, "not_found", "No night audit for that date"));
    const pdf = renderAuditPdf(report);
    reply.header("content-type", "application/pdf");
    reply.header("content-disposition", `attachment; filename="night-audit-${req.params.date}.pdf"`);
    return reply.send(Buffer.from(pdf));
  });

  f.post<{ Params: { date: string } }>("/v1/night-audit/:date/email", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "night.audit", reply)) return;
    if (!DATE.test(req.params.date)) return reply.code(422).send(problem(422, "validation", "Use a date like 2026-09-28"));
    const loaded = await loadSettings(a.propertyId);
    if (!loaded?.gm) return reply.code(422).send(problem(422, "validation", "Add a general manager address in settings"));
    const row = (await pool.query(
      `select id, data from night_audit where property_id=$1 and audit_date=$2::date`,
      [a.propertyId, req.params.date],
    )).rows[0];
    const report = asReport(row?.data);
    if (!row || !report) return reply.code(404).send(problem(404, "not_found", "No night audit for that date"));
    const status = await deliver(a.propertyId, a.tenantId, row.id, report, loaded.gm, a.userId);
    return { ok: true, status };
  });

  f.get<{ Params: { date: string } }>("/v1/night-audit/:date", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "night.audit", reply)) return;
    if (!DATE.test(req.params.date)) return reply.code(422).send(problem(422, "validation", "Use a date like 2026-09-28"));
    const row = (await pool.query(
      `select id, audit_date::text as audit_date, generated_at, source, emailed_at, data as report
       from night_audit where property_id=$1 and audit_date=$2::date`,
      [a.propertyId, req.params.date],
    )).rows[0];
    if (!row) return reply.code(404).send(problem(404, "not_found", "No night audit for that date"));
    return row;
  });
}
