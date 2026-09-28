/** Night audit snapshots. The 15-minute scheduler writes one row per property per London date. */
import type { FastifyInstance } from "fastify";
import { pool } from "./db.ts";
import { requireActor, allow, problem } from "./auth.ts";
import { sendEmail } from "./email.ts";
import { parseFaultRouting } from "../../../domains/ops/fault.ts";
import { loadHouseFacts } from "./houseFacts.ts";
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

async function collect(propertyId: string, today: string, tomorrow: string) {
  const facts = await loadHouseFacts({
    propertyId,
    stayOn: tomorrow,
    roomFrom: today,
    roomTo: tomorrow,
    occupancyOn: today,
    paidOn: today,
    ticketOn: today,
    issueOn: today,
    trainingOn: today,
    trainingDays: 30,
    complianceOn: today,
    complianceDays: 7,
    handoverDates: [today, tomorrow],
    handoverMorning: true,
    handoverLimit: 12,
    deliveryOn: tomorrow,
    includeInHouse: false,
    shiftsOn: null,
    logAs: "night-audit",
  });
  const stays = [];
  for (const row of facts.stays) {
    const base = {
      givenName: row.givenName,
      familyName: row.familyName,
      groupName: row.groupName,
      room: row.room,
      party: row.party,
      returning: row.returning,
      severity: row.severe ? "ANAPHYLAXIS" : null,
      accessibility: row.accessibility,
    };
    if (row.arrivalDate === tomorrow) stays.push(projectStay({ ...base, movement: "arrival" as const }));
    if (row.departureDate === tomorrow) stays.push(projectStay({ ...base, movement: "departure" as const }));
  }
  return buildNightAudit({
    auditDate: today,
    tomorrow,
    stays,
    occupiedRooms: facts.occupiedRooms,
    availableRooms: facts.availableRooms,
    payments: facts.payments,
    tickets: facts.tickets.map(({ number, title, priority, status, ageDays, location }) => ({ number, title, priority, status, ageDays, location })),
    issues: facts.issues.map(({ label, overdue }) => ({ label, overdue })),
    stock: facts.stock.map(({ name, quantity, unit, low }) => ({ name, quantity, unit, low })),
    training: facts.training.map(({ name, title, expiresOn }) => ({ name, title, expiresOn })),
    compliance: facts.compliance.map(({ title, dueOn }) => ({ title, dueOn })),
    notes: facts.notes.map(({ author, department, shift, excerpt }) => ({ author, department, shift, excerpt })),
    deliveries: facts.deliveries.map(({ supplier, detail }) => ({ supplier, detail })),
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
