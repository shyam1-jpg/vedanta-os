/**
 * The workforce pieces that sit beside the rota: chat, schedule tools,
 * leave accounts, settings, reports, news, payslips and profiles.
 * Owner and GM act for the whole house. A head of department acts for their own.
 */
import type { FastifyInstance } from "fastify";
import { pool } from "./db.ts";
import { requireActor, problem, type Actor } from "./auth.ts";
import { sanitizeRichText } from "../../../domains/ops/suite.ts";
import {
  ANNUAL_LEAVE_DAYS, HOURLY_ACCRUAL_PERCENT, ROTA_DEPARTMENTS, accrualYear, hourlyAccrual,
  leaveAvailable, mayApproveDepartment, mayPublishDepartment, mayPublishRota, planAutoSchedule, shiftHours, weekRange,
} from "../../../domains/ops/workforce.ts";
import { audit, notifyUsers } from "./workforce-shared.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEPTS = ["HOUSE", "FRONT", "NIGHT", "HK", "KITCHEN", "RESTAURANT", "MAINT", "GROUNDS", "MGMT"];
const MEDIA = /^(application\/pdf|image\/(?:jpeg|png|webp|gif)|audio\/(?:webm|ogg|mpeg|mp4|wav)|video\/(?:mp4|webm))$/i;

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
function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function reader(req: any, reply: any): Promise<Actor | null> {
  const a = await requireActor(req, reply, ["ADMIN", "STAFF"]);
  if (!a) return null;
  if (a.perms.has("group.read") || a.perms.has("clock.self") || a.perms.has("cover.read") || mayPublishRota(a.perms) || a.perms.has("leave.approve_hod")) return a;
  reply.code(403).send(problem(403, "forbidden", "You cannot open workforce"));
  return null;
}

function canManage(a: Actor, department: string) {
  return mayPublishDepartment(a.perms, a.department, department);
}

function parseData(data: string, max = 4_000_000): { mime: string; bytes: Buffer } | null {
  const m = /^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i.exec(String(data ?? "").trim());
  if (!m || !MEDIA.test(m[1])) return null;
  const bytes = Buffer.from(m[2].replace(/\s/g, ""), "base64");
  if (!bytes.length || bytes.length > max) return null;
  return { mime: m[1].toLowerCase(), bytes };
}

function mediaKind(mime: string): "voice" | "photo" | "video" | "gif" {
  if (mime === "image/gif") return "gif";
  if (mime.startsWith("audio/")) return "voice";
  if (mime.startsWith("video/")) return "video";
  return "photo";
}

function csvCell(v: unknown) { return `"${String(v ?? "").replace(/"/g, "\"\"")}"`; }
function sheet(name: string, rows: unknown[][]) {
  const csv = rows.map(row => row.map(csvCell).join(",")).join("\n");
  const xml = rows.map(row => `<Row>${row.map(cell => `<Cell><Data ss:Type="String">${String(cell ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</Data></Cell>`).join("")}</Row>`).join("");
  const xls = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="${name}"><Table>${xml}</Table></Worksheet></Workbook>`;
  return { csv, xls };
}
function sendSheet(reply: any, format: string, filename: string, rows: unknown[][]) {
  const file = sheet(filename, rows);
  if (format === "xls") {
    reply.header("content-type", "application/vnd.ms-excel").header("content-disposition", `attachment; filename="${filename}.xls"`);
    return reply.send(file.xls);
  }
  reply.header("content-type", "text/csv").header("content-disposition", `attachment; filename="${filename}.csv"`);
  return reply.send(file.csv);
}

async function colleague(propertyId: string, userId: string) {
  const row = (await pool.query(
    `select u.id from app_user u join membership m on m.user_id = u.id where u.id = $1 and m.property_id = $2 and u.status = 'ACTIVE' limit 1`,
    [userId, propertyId],
  )).rows[0];
  return Boolean(row);
}

export default async function workforceExtra(f: FastifyInstance) {
  f.get("/v1/workforce-desk/notifications", async (req, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const items = (await pool.query(
      `select id, title, body, href, read_at, created_at from wf_notification where user_id = $1 order by created_at desc limit 30`,
      [a.userId],
    )).rows;
    const unread = items.filter((row: { read_at: string | null }) => !row.read_at).length;
    const chat = (await pool.query(
      `select count(*)::int n from wf_chat_message m
       join wf_chat_member mem on mem.chat_id = m.chat_id and mem.user_id = $1
       where m.author_user_id is distinct from $1 and m.created_at > coalesce(mem.last_read_at, 'epoch')`,
      [a.userId],
    )).rows[0];
    return { unread, chat_unread: chat?.n ?? 0, items };
  });

  f.post("/v1/workforce-desk/notifications/read", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const id = uuid(req.body?.id);
    await pool.query(
      `update wf_notification set read_at = now() where user_id = $1 and read_at is null and ($2::uuid is null or id = $2)`,
      [a.userId, id],
    );
    return { ok: true };
  });

  f.get("/v1/workforce-desk/chats", async (req, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const chats = (await pool.query(
      `select c.id, c.kind, c.title, c.created_at,
              (select body from wf_chat_message m where m.chat_id = c.id order by m.created_at desc limit 1) last_body,
              (select kind from wf_chat_message m where m.chat_id = c.id order by m.created_at desc limit 1) last_kind,
              (select count(*)::int from wf_chat_message m where m.chat_id = c.id and m.author_user_id is distinct from $1 and m.created_at > coalesce(mem.last_read_at, 'epoch')) unread
       from wf_chat c join wf_chat_member mem on mem.chat_id = c.id and mem.user_id = $1
       where c.property_id = $2 order by c.created_at desc`,
      [a.userId, a.propertyId],
    )).rows;
    const members = (await pool.query(
      `select m.chat_id, u.id, u.display_name name from wf_chat_member m
       join app_user u on u.id = m.user_id
       join wf_chat_member mine on mine.chat_id = m.chat_id and mine.user_id = $1`,
      [a.userId],
    )).rows;
    const people = (await pool.query(
      `select distinct u.id, u.display_name name from membership m join app_user u on u.id = m.user_id
       where m.property_id = $1 and u.status = 'ACTIVE' and u.id <> $2 order by name`,
      [a.propertyId, a.userId],
    )).rows;
    return {
      chats: chats.map((chat: any) => ({ ...chat, members: members.filter((m: any) => m.chat_id === chat.id).map((m: any) => ({ id: m.id, name: m.name })) })),
      people,
    };
  });

  f.post("/v1/workforce-desk/chats", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const kind = req.body?.kind === "group" ? "group" : "direct";
    const ids = [...new Set((Array.isArray(req.body?.member_ids) ? req.body.member_ids : []).map(uuid).filter(Boolean) as string[])].filter(id => id !== a.userId);
    if (!ids.length) return reply.code(422).send(problem(422, "validation", "Choose who to talk to"));
    for (const id of ids) if (!(await colleague(a.propertyId, id))) return reply.code(422).send(problem(422, "validation", "Choose people who work here"));
    if (kind === "direct") {
      const existing = (await pool.query(
        `select c.id from wf_chat c
         where c.property_id = $1 and c.kind = 'direct'
           and (select count(*) from wf_chat_member m where m.chat_id = c.id) = 2
           and exists (select 1 from wf_chat_member m where m.chat_id = c.id and m.user_id = $2)
           and exists (select 1 from wf_chat_member m where m.chat_id = c.id and m.user_id = $3)
         limit 1`,
        [a.propertyId, a.userId, ids[0]],
      )).rows[0];
      if (existing) return { id: existing.id };
    }
    const title = kind === "group" ? String(req.body?.title ?? "").trim().slice(0, 80) : "";
    if (kind === "group" && !title) return reply.code(422).send(problem(422, "validation", "Name the group"));
    const chat = (await pool.query(
      `insert into wf_chat (tenant_id, property_id, kind, title, created_by) values ($1,$2,$3,$4,$5) returning id`,
      [a.tenantId, a.propertyId, kind, title, a.userId],
    )).rows[0];
    for (const id of [a.userId, ...ids]) {
      await pool.query(`insert into wf_chat_member (chat_id, user_id) values ($1,$2) on conflict do nothing`, [chat.id, id]);
    }
    reply.code(201);
    return { id: chat.id };
  });

  f.get("/v1/workforce-desk/chats/:id", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const member = (await pool.query(`select 1 from wf_chat_member where chat_id = $1 and user_id = $2`, [req.params.id, a.userId])).rowCount;
    if (!member) return reply.code(404).send(problem(404, "not_found", "You are not in that chat"));
    await pool.query(`update wf_chat_member set last_read_at = now() where chat_id = $1 and user_id = $2`, [req.params.id, a.userId]);
    const messages = (await pool.query(
      `select m.id, m.body, m.kind, m.filename, m.mime, (m.bytes is not null) as has_file, m.created_at, u.display_name author, m.author_user_id
       from wf_chat_message m left join app_user u on u.id = m.author_user_id
       where m.chat_id = $1 order by m.created_at limit 200`,
      [req.params.id],
    )).rows;
    return { messages };
  });

  f.post("/v1/workforce-desk/chats/:id/messages", { bodyLimit: 6_000_000 }, async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const member = (await pool.query(`select 1 from wf_chat_member where chat_id = $1 and user_id = $2`, [req.params.id, a.userId])).rowCount;
    if (!member) return reply.code(404).send(problem(404, "not_found", "You are not in that chat"));
    const body = String(req.body?.body ?? "").trim().slice(0, 2000);
    const file = req.body?.data ? parseData(req.body.data) : null;
    if (req.body?.data && !file) return reply.code(422).send(problem(422, "validation", "Send a photo, video, GIF, voice note or PDF"));
    if (!body && !file) return reply.code(422).send(problem(422, "validation", "Write a message or attach a file"));
    const kind = file ? mediaKind(file.mime) : "text";
    const saved = (await pool.query(
      `insert into wf_chat_message (chat_id, author_user_id, body, kind, filename, mime, bytes)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [req.params.id, a.userId, body, kind, String(req.body?.filename ?? "").slice(0, 120), file?.mime ?? "", file?.bytes ?? null],
    )).rows[0];
    const others = (await pool.query(`select user_id from wf_chat_member where chat_id = $1 and user_id <> $2`, [req.params.id, a.userId])).rows.map((r: { user_id: string }) => r.user_id);
    await notifyUsers(a.propertyId, others, `Message from ${a.name}`, body || kind, "/workforce/chat/");
    reply.code(201);
    return { id: saved.id };
  });

  f.get("/v1/workforce-desk/chat-files/:id", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const row = (await pool.query(
      `select m.mime, m.bytes, m.filename from wf_chat_message m
       join wf_chat_member mem on mem.chat_id = m.chat_id and mem.user_id = $2
       where m.id = $1`,
      [req.params.id, a.userId],
    )).rows[0];
    if (!row?.bytes) return reply.code(404).send(problem(404, "not_found", "No file on that message"));
    reply.header("content-type", row.mime || "application/octet-stream");
    reply.header("content-disposition", `inline; filename="${String(row.filename || "file").replace(/"/g, "")}"`);
    return reply.send(row.bytes);
  });

  f.get("/v1/workforce-desk/templates", async (req, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const templates = (await pool.query(
      `select id, title, department, created_at from rota_template where property_id = $1 order by title`,
      [a.propertyId],
    )).rows;
    const lines = (await pool.query(
      `select l.template_id, l.id, l.weekday, l.start_time::text start_time, l.end_time::text end_time, l.break_minutes, l.position, l.user_id
       from rota_template_line l join rota_template t on t.id = l.template_id where t.property_id = $1 order by l.weekday, l.start_time`,
      [a.propertyId],
    )).rows;
    return { templates: templates.map((t: any) => ({ ...t, lines: lines.filter((l: any) => l.template_id === t.id) })) };
  });

  f.post("/v1/workforce-desk/templates/from-week", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const department = dept(req.body?.department);
    if (!canManage(a, department)) return reply.code(403).send(problem(403, "forbidden", "You save templates for your own department."));
    const title = String(req.body?.title ?? "").trim().slice(0, 120);
    const from = day(req.body?.from);
    const to = day(req.body?.to);
    if (!title || !department || !from || !to) return reply.code(422).send(problem(422, "validation", "Name the template, the department and the week"));
    const template = (await pool.query(
      `insert into rota_template (tenant_id, property_id, title, department, created_by) values ($1,$2,$3,$4,$5) returning id`,
      [a.tenantId, a.propertyId, title, department, a.userId],
    )).rows[0];
    const shifts = (await pool.query(
      `select user_id, shift_date::text date, start_time::text, end_time::text, break_minutes, position, notes
       from rota_shift where property_id = $1 and department = $2 and shift_date between $3::date and $4::date`,
      [a.propertyId, department, from, to],
    )).rows;
    for (const shift of shifts) {
      const weekday = (new Date(`${shift.date}T12:00:00Z`).getUTCDay() + 6) % 7;
      await pool.query(
        `insert into rota_template_line (template_id, weekday, start_time, end_time, break_minutes, position, notes, user_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [template.id, weekday, shift.start_time, shift.end_time, shift.break_minutes, shift.position ?? "", shift.notes ?? "", shift.user_id],
      );
    }
    await audit(a, "template", `Saved ${title} from ${from}`);
    reply.code(201);
    return { id: template.id, lines: shifts.length };
  });

  f.patch("/v1/workforce-desk/templates/:id", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const template = (await pool.query(`select id, department from rota_template where id = $1 and property_id = $2`, [req.params.id, a.propertyId])).rows[0];
    if (!template) return reply.code(404).send(problem(404, "not_found", "No such template"));
    if (!canManage(a, template.department)) return reply.code(403).send(problem(403, "forbidden", "You edit templates for your own department."));
    const title = String(req.body?.title ?? "").trim().slice(0, 120);
    if (title) await pool.query(`update rota_template set title = $2 where id = $1`, [template.id, title]);
    if (Array.isArray(req.body?.lines)) {
      await pool.query(`delete from rota_template_line where template_id = $1`, [template.id]);
      for (const line of req.body.lines) {
        const start = clockTime(line?.start_time);
        const end = clockTime(line?.end_time);
        const weekday = Number(line?.weekday);
        if (!start || !end || weekday < 0 || weekday > 6) continue;
        await pool.query(
          `insert into rota_template_line (template_id, weekday, start_time, end_time, break_minutes, position, notes, user_id)
           values ($1,$2,$3,$4,$5,$6,'',$7)`,
          [template.id, weekday, start, end, Number(line?.break_minutes) || 0, String(line?.position ?? "").slice(0, 80), uuid(line?.user_id)],
        );
      }
    }
    return { ok: true };
  });

  f.post("/v1/workforce-desk/shifts/copy-week", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const department = dept(req.body?.department);
    if (!canManage(a, department)) return reply.code(403).send(problem(403, "forbidden", "You copy weeks on your own rota."));
    const from = day(req.body?.from);
    const to = day(req.body?.to);
    const target = day(req.body?.target);
    if (!from || !to || !target) return reply.code(422).send(problem(422, "validation", "Choose the week to copy and where it lands"));
    const shifts = (await pool.query(
      `select user_id, department, position, shift_type, shift_date::text date, start_time::text, end_time::text, break_minutes, notes
       from rota_shift where property_id = $1 and shift_date between $2::date and $3::date and ($4 = '' or department = $4)`,
      [a.propertyId, from, to, department],
    )).rows;
    let created = 0;
    for (const shift of shifts) {
      const offset = Math.round((Date.parse(shift.date) - Date.parse(from)) / 86400000);
      await pool.query(
        `insert into rota_shift (tenant_id, property_id, user_id, department, position, shift_type, shift_date, start_time, end_time, break_minutes, notes, published, created_by)
         values ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11,false,$12)`,
        [a.tenantId, a.propertyId, shift.user_id, shift.department, shift.position, shift.shift_type, addDays(target, offset), shift.start_time, shift.end_time, shift.break_minutes, shift.notes, a.userId],
      );
      created += 1;
    }
    await audit(a, "copy-week", `${from} copied to ${target} (${created} drafts)`);
    reply.code(201);
    return { created };
  });

  f.post("/v1/workforce-desk/shifts/approve", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(uuid).filter(Boolean) as string[];
    if (!ids.length) return reply.code(422).send(problem(422, "validation", "Choose the shifts to approve"));
    const rows = (await pool.query(`select id, department from rota_shift where property_id = $1 and id = any($2::uuid[])`, [a.propertyId, ids])).rows;
    const allowed = rows.filter((row: { department: string }) => canManage(a, row.department)).map((row: { id: string }) => row.id);
    if (!allowed.length) return reply.code(403).send(problem(403, "forbidden", "You approve shifts in your own department."));
    await pool.query(`update rota_shift set approved_at = now(), approved_by = $2, status = 'confirmed' where id = any($1::uuid[])`, [allowed, a.userId]);
    await audit(a, "approve", `${allowed.length} shifts`);
    return { approved: allowed.length };
  });

  f.post("/v1/workforce-desk/shifts/clear", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const department = dept(req.body?.department);
    if (!canManage(a, department)) return reply.code(403).send(problem(403, "forbidden", "You delete shifts on your own rota."));
    const from = day(req.body?.from);
    const to = day(req.body?.to);
    if (!from || !to) return reply.code(422).send(problem(422, "validation", "Choose the week"));
    const r = await pool.query(
      `delete from rota_shift where property_id = $1 and shift_date between $2::date and $3::date and ($4 = '' or department = $4)`,
      [a.propertyId, from, to, department],
    );
    await audit(a, "delete-week", `${department || "all"} ${from} to ${to} (${r.rowCount ?? 0})`);
    return { deleted: r.rowCount ?? 0 };
  });

  f.post("/v1/workforce-desk/shifts/auto", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    let department = dept(req.body?.department);
    if (!mayPublishRota(a.perms)) department = a.department ?? "";
    if (!department || !canManage(a, department)) {
      if (!mayPublishRota(a.perms)) return reply.code(403).send(problem(403, "forbidden", "You auto-schedule your own department."));
    }
    let from = day(req.body?.from);
    let to = day(req.body?.to);
    const weeks = Math.min(8, Math.max(1, Number(req.body?.weeks) || 1));
    if (from && !to) to = addDays(from, weeks * 7 - 1);
    if (!from || !to) return reply.code(422).send(problem(422, "validation", "Choose the period"));
    const open = (await pool.query(
      `select id, department, shift_date::text date, start_time::text start_time, end_time::text end_time, break_minutes
       from rota_shift where property_id = $1 and user_id is null and shift_date between $2::date and $3::date and ($4 = '' or department = $4)`,
      [a.propertyId, from, to, department],
    )).rows;
    const assigned = (await pool.query(
      `select user_id, department, shift_date::text date, start_time::text start_time, end_time::text end_time, break_minutes
       from rota_shift where property_id = $1 and user_id is not null and shift_date between $2::date and $3::date`,
      [a.propertyId, addDays(from, -28), to],
    )).rows;
    const off = (await pool.query(
      `select user_id, on_date::text date from staff_availability where property_id = $1 and available = false and on_date between $2::date and $3::date`,
      [a.propertyId, from, to],
    )).rows;
    const leave = (await pool.query(
      `select user_id, from_date::text, to_date::text from absence_request where property_id = $1 and status in ('pending','approved') and to_date >= $2::date and from_date <= $3::date`,
      [a.propertyId, from, to],
    )).rows;
    const staff = (await pool.query(
      `select u.id, sd.department, coalesce(h.contracted_hours, 0) contracted
       from staff_department sd join app_user u on u.id = sd.user_id
       left join staff_hr h on h.user_id = u.id
       where sd.property_id = $1 and u.status = 'ACTIVE'`,
      [a.propertyId],
    )).rows;
    const byUser = new Map<string, { departments: string[]; contracted: number }>();
    for (const row of staff) {
      const cur = byUser.get(row.id) ?? { departments: [], contracted: Number(row.contracted) || 0 };
      cur.departments.push(row.department);
      byUser.set(row.id, cur);
    }
    const rule = (await pool.query(`select weekly_cap from wf_contract_rule where property_id = $1`, [a.propertyId])).rows[0];
    const people = [...byUser.entries()].map(([id, info]) => {
      const weekHours: Record<string, number> = {};
      for (const row of assigned.filter((s: any) => s.user_id === id && s.date >= from)) {
        const week = weekRange(row.date).from;
        weekHours[week] = Math.round(((weekHours[week] ?? 0) + shiftHours(row.start_time, row.end_time, row.break_minutes)) * 10) / 10;
      }
      const past = assigned.filter((s: any) => s.user_id === id && s.date < from);
      const pattern = [...new Map(past.map((row: any) => {
        const weekday = (new Date(`${row.date}T12:00:00Z`).getUTCDay() + 6) % 7;
        const start = String(row.start_time).slice(0, 5);
        const key = `${weekday}|${start}|${row.department ?? ""}`;
        return [key, { weekday, start, department: row.department ?? "" }];
      })).values()];
      const unavailable = off.filter((row: any) => row.user_id === id).map((row: any) => row.date);
      const away: string[] = [];
      for (const row of leave.filter((item: any) => item.user_id === id)) {
        for (let cursor = row.from_date; cursor <= row.to_date && cursor <= to; cursor = addDays(cursor, 1)) if (cursor >= from) away.push(cursor);
      }
      return { id, departments: info.departments, contractedWeekly: info.contracted, unavailable, leave: away, weekHours, pattern };
    });
    const placed = planAutoSchedule({
      shifts: open.map((row: any) => ({ id: row.id, department: row.department, date: row.date, hours: shiftHours(row.start_time, row.end_time, row.break_minutes), start: String(row.start_time).slice(0, 5) })),
      people, excludeUserIds: (req.body?.exclude_user_ids ?? []).map(uuid).filter(Boolean),
      excludeDates: (req.body?.exclude_dates ?? []).map(day).filter(Boolean),
      useContracted: req.body?.use_contracted !== false,
      useAvailability: req.body?.use_availability !== false,
      useRules: req.body?.use_rules !== false,
      usePatterns: req.body?.use_patterns !== false,
      maxHours: Number(rule?.weekly_cap) || 48,
    });
    for (const pick of placed) {
      await pool.query(`update rota_shift set user_id = $2, shift_type = 'shift', published = false where id = $1 and property_id = $3 and user_id is null`, [pick.shiftId, pick.userId, a.propertyId]);
    }
    await audit(a, "auto-schedule", `${placed.length} drafts from ${from} to ${to}`);
    return { suggested: placed.length, skipped: open.length - placed.length, drafts: true };
  });

  f.get("/v1/workforce-desk/schedule/tools", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const from = day(req.query?.from) ?? new Date().toISOString().slice(0, 10);
    const to = day(req.query?.to) ?? from;
    const view = String(req.query?.view ?? "overview");
    const department = view === "rules" || view === "contracted" ? "" : dept(req.query?.department);
    const shifts = (await pool.query(
      `select s.id, s.user_id, u.display_name name, s.department, s.shift_type, s.shift_date::text date, s.start_time::text start_time,
              s.end_time::text end_time, s.break_minutes, s.published, s.approved_at, coalesce(h.contracted_hours, 0) contracted
       from rota_shift s left join app_user u on u.id = s.user_id left join staff_hr h on h.user_id = s.user_id
       where s.property_id = $1 and s.shift_date between $2::date and $3::date and ($4 = '' or s.department = $4)
       order by s.shift_date, s.start_time`,
      [a.propertyId, from, to, department],
    )).rows;
    if (view === "history") {
      const items = (await pool.query(
        `select a.action, a.detail, a.created_at, u.display_name name from rota_audit a left join app_user u on u.id = a.actor_user_id
         where a.property_id = $1 order by a.created_at desc limit 80`,
        [a.propertyId],
      )).rows;
      return { view, items };
    }
    if (view === "rules" || view === "contracted") {
      const rule = (await pool.query(`select weekly_cap from wf_contract_rule where property_id = $1`, [a.propertyId])).rows[0];
      const cap = Number(rule?.weekly_cap) || 48;
      const bag = new Map<string, { name: string; hours: number; contracted: number }>();
      for (const shift of shifts) {
        if (!shift.user_id) continue;
        const cur = bag.get(shift.user_id) ?? { name: shift.name, hours: 0, contracted: Number(shift.contracted) || 0 };
        cur.hours = Math.round((cur.hours + shiftHours(shift.start_time, shift.end_time, shift.break_minutes)) * 10) / 10;
        bag.set(shift.user_id, cur);
      }
      const rows = [...bag.entries()].map(([id, row]) => ({ id, ...row, over_cap: row.hours > cap + 0.001, over_contract: row.contracted > 0 && row.hours > row.contracted + 0.001 }));
      return { view, cap, rows: view === "rules" ? rows.filter(row => row.over_cap || row.over_contract) : rows };
    }
    return { view: "overview", shifts };
  });

  f.get("/v1/workforce-desk/schedule/export", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    if (!mayPublishRota(a.perms) && !a.perms.has("leave.approve_hod")) return reply.code(403).send(problem(403, "forbidden", "Managers export the rota."));
    const from = day(req.query?.from) ?? new Date().toISOString().slice(0, 10);
    const to = day(req.query?.to) ?? from;
    const department = dept(req.query?.department);
    const rows = (await pool.query(
      `select coalesce(u.display_name, 'Open') name, s.department, s.shift_date::text date, s.start_time::text start_time, s.end_time::text end_time,
              s.break_minutes, s.shift_type, case when s.published then 'published' else 'draft' end status
       from rota_shift s left join app_user u on u.id = s.user_id
       where s.property_id = $1 and s.shift_date between $2::date and $3::date and ($4 = '' or s.department = $4)
       order by s.shift_date, name`,
      [a.propertyId, from, to, department],
    )).rows;
    const table = [["Name", "Department", "Date", "Start", "End", "Break", "Type", "Status"], ...rows.map((r: any) => [r.name, r.department, r.date, String(r.start_time).slice(0, 5), String(r.end_time).slice(0, 5), r.break_minutes, r.shift_type, r.status])];
    return sendSheet(reply, String(req.query?.format ?? "csv"), "rota", table);
  });

  f.get("/v1/workforce-desk/leave/policies", async (req, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const policies = (await pool.query(`select id, code, name, method, days, accrual_percent from wf_leave_policy where property_id = $1 order by code`, [a.propertyId])).rows;
    const contract = (await pool.query(`select weekly_cap, default_contracted, break_minutes from wf_contract_rule where property_id = $1`, [a.propertyId])).rows[0]
      ?? { weekly_cap: 48, default_contracted: 37.5, break_minutes: 30 };
    const overtime = (await pool.query(`select after_hours, multiplier from wf_overtime_rule where property_id = $1`, [a.propertyId])).rows[0]
      ?? { after_hours: 48, multiplier: 1.5 };
    const year = accrualYear(new Date().toISOString().slice(0, 10));
    return { policies, contract, overtime, year, annual_days: ANNUAL_LEAVE_DAYS, hourly_percent: HOURLY_ACCRUAL_PERCENT, can_edit: mayPublishRota(a.perms) };
  });

  f.put("/v1/workforce-desk/settings", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    if (!mayPublishRota(a.perms)) return reply.code(403).send(problem(403, "forbidden", "The owner or a general manager edits house rules."));
    const weekly = Number(req.body?.weekly_cap);
    const contracted = Number(req.body?.default_contracted);
    const after = Number(req.body?.after_hours);
    const multiplier = Number(req.body?.multiplier);
    await pool.query(
      `insert into wf_contract_rule (property_id, weekly_cap, default_contracted) values ($1,$2,$3)
       on conflict (property_id) do update set weekly_cap = excluded.weekly_cap, default_contracted = excluded.default_contracted`,
      [a.propertyId, weekly > 0 ? weekly : 48, contracted > 0 ? contracted : 37.5],
    );
    await pool.query(
      `insert into wf_overtime_rule (property_id, after_hours, multiplier) values ($1,$2,$3)
       on conflict (property_id) do update set after_hours = excluded.after_hours, multiplier = excluded.multiplier`,
      [a.propertyId, after > 0 ? after : 48, multiplier > 0 ? multiplier : 1.5],
    );
    if (Array.isArray(req.body?.policies)) {
      for (const policy of req.body.policies) {
        const id = uuid(policy?.id);
        if (!id) continue;
        await pool.query(
          `update wf_leave_policy set name = $2, days = $3, accrual_percent = $4 where id = $1 and property_id = $5`,
          [id, String(policy.name ?? "").slice(0, 80), Number(policy.days) || 0, Number(policy.accrual_percent) || 0, a.propertyId],
        );
      }
    }
    return { ok: true };
  });

  f.get("/v1/workforce-desk/leave/accounts", async (req, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const manage = mayPublishRota(a.perms) || a.perms.has("leave.approve_hod") || a.perms.has("clock.manage");
    const year = accrualYear(new Date().toISOString().slice(0, 10));
    if (manage) {
      await pool.query(
        `insert into leave_account (user_id, property_id, year, kind, allowance_days, valid_from, valid_until, accruing_rate, start_balance, accrued)
         select distinct m.user_id, m.property_id, $2::int, k.kind, case when k.kind = 'annual' then 28 else 0 end::numeric, $3::date, $4::date,
                case when k.kind = 'hourly' then 12.07 else 0 end::numeric, 0::numeric, case when k.kind = 'annual' then 28 else 0 end::numeric
         from membership m join app_user u on u.id = m.user_id
         cross join (values ('annual'), ('hourly'), ('toil')) k(kind)
         where m.property_id = $1 and u.status = 'ACTIVE'
         on conflict (user_id, year, kind) do nothing`,
        [a.propertyId, year.year, year.from, year.until],
      );
    }
    const accounts = (await pool.query(
      `select la.user_id, u.display_name name, la.kind, la.year, la.valid_from::text, la.valid_until::text, la.accruing_rate,
              la.start_balance, la.accrued, la.carried_days, la.allowance_days
       from leave_account la join app_user u on u.id = la.user_id
       where la.property_id = $1 and la.year = $2 and ($3::boolean or la.user_id = $4)
       order by u.display_name, la.kind`,
      [a.propertyId, year.year, manage, a.userId],
    )).rows;
    const used = (await pool.query(
      `select user_id, kind, coalesce(sum(days), 0) days from absence_request
       where property_id = $1 and status = 'approved' and to_date >= $2::date and from_date <= $3::date
       group by user_id, kind`,
      [a.propertyId, year.from, year.until],
    )).rows;
    const hours = (await pool.query(
      `select user_id, start_time::text start_time, end_time::text end_time, break_minutes from rota_shift
       where property_id = $1 and user_id is not null and shift_date between $2::date and $3::date`,
      [a.propertyId, year.from, year.until],
    )).rows;
    const hourBag = new Map<string, number>();
    for (const row of hours) hourBag.set(row.user_id, (hourBag.get(row.user_id) ?? 0) + shiftHours(row.start_time, row.end_time, row.break_minutes));
    const usedOf = (userId: string, kind: string) => {
      const match = kind === "annual" ? ["holiday", "annual"] : [kind];
      return used.filter((row: any) => row.user_id === userId && match.includes(row.kind)).reduce((n: number, row: any) => n + Number(row.days), 0);
    };
    return {
      year,
      accounts: accounts.map((row: any) => {
        const accrued = row.kind === "hourly" ? hourlyAccrual(hourBag.get(row.user_id) ?? 0, Number(row.accruing_rate) || HOURLY_ACCRUAL_PERCENT) : Number(row.accrued);
        const taken = usedOf(row.user_id, row.kind);
        return { ...row, accrued, used: taken, available: leaveAvailable({ start: Number(row.start_balance), accrued, carried: Number(row.carried_days), used: taken }) };
      }),
    };
  });

  f.put("/v1/workforce-desk/leave/accounts", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const userId = uuid(req.body?.user_id);
    const kind = ["annual", "hourly", "toil"].includes(req.body?.kind) ? req.body.kind : "";
    if (!userId || !kind) return reply.code(422).send(problem(422, "validation", "Choose the person and the account"));
    if (!mayApproveDepartment(a.perms, a.department, await userDept(a.propertyId, userId)) && !mayPublishRota(a.perms)) {
      return reply.code(403).send(problem(403, "forbidden", "You manage leave in your own department."));
    }
    const year = accrualYear(day(req.body?.valid_from) ?? new Date().toISOString().slice(0, 10));
    await pool.query(
      `insert into leave_account (user_id, property_id, year, kind, allowance_days, valid_from, valid_until, accruing_rate, start_balance, accrued)
       values ($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9,$10)
       on conflict (user_id, year, kind) do update set valid_from = excluded.valid_from, valid_until = excluded.valid_until,
         accruing_rate = excluded.accruing_rate, start_balance = excluded.start_balance, accrued = excluded.accrued`,
      [userId, a.propertyId, year.year, kind, kind === "annual" ? ANNUAL_LEAVE_DAYS : 0, day(req.body?.valid_from) ?? year.from, day(req.body?.valid_until) ?? year.until, Number(req.body?.accruing_rate) || 0, Number(req.body?.start_balance) || 0, Number(req.body?.accrued) || 0],
    );
    return { ok: true };
  });

  f.get("/v1/workforce-desk/reports/view", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    if (!mayPublishRota(a.perms) && !a.perms.has("clock.manage") && !a.perms.has("leave.approve_hod")) {
      return reply.code(403).send(problem(403, "forbidden", "Workforce reports are for managers."));
    }
    const built = await reportRows(a, req.query ?? {});
    const format = String(req.query?.format ?? "");
    if (format === "csv" || format === "xls") {
      const header = built.kind === "types" ? ["Shift type", "Shifts", "Hours"] : ["Name", "Department", "Group", "Shifts", "Hours", "Previous hours"];
      const body = built.kind === "types"
        ? built.types.map(row => [row.shift_type, row.count, row.hours])
        : built.rows.map(row => [row.name, row.department, row.group, row.shifts, row.hours, row.compare_hours]);
      return sendSheet(reply, format, built.kind, [header, ...body]);
    }
    return built;
  });

  f.get("/v1/workforce-desk/news", async (req, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const news = (await pool.query(
      `select id, title, body, department, staff_group, created_at from ops_news where property_id = $1 order by created_at desc limit 40`,
      [a.propertyId],
    )).rows;
    const events = (await pool.query(
      `select id, title, body, location, starts_at, ends_at, department, staff_group from ops_appointment where property_id = $1 order by starts_at desc limit 40`,
      [a.propertyId],
    )).rows;
    const groups = (await pool.query(
      `select distinct r.code, r.name from membership m join role r on r.id = m.role_id where m.property_id = $1 order by r.name`,
      [a.propertyId],
    )).rows;
    return { news: visible(a, news), events: visible(a, events), groups, departments: ROTA_DEPARTMENTS, can_publish: mayPublishRota(a.perms) };
  });

  f.post("/v1/workforce-desk/news", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const department = dept(req.body?.department);
    if (!canManage(a, department)) return reply.code(403).send(problem(403, "forbidden", "You post news for your own department."));
    const title = String(req.body?.title ?? "").trim().slice(0, 140);
    if (!title) return reply.code(422).send(problem(422, "validation", "Give it a title"));
    const row = (await pool.query(
      `insert into ops_news (tenant_id, property_id, title, body, department, staff_group, author_user_id, author_name)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [a.tenantId, a.propertyId, title, sanitizeRichText(String(req.body?.body ?? "")).slice(0, 4000), department, String(req.body?.staff_group ?? "").slice(0, 40), a.userId, a.name],
    )).rows[0];
    reply.code(201);
    return { id: row.id };
  });

  f.patch("/v1/workforce-desk/news/:id", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const row = (await pool.query(`select id, department from ops_news where id = $1 and property_id = $2`, [req.params.id, a.propertyId])).rows[0];
    if (!row) return reply.code(404).send(problem(404, "not_found", "No such news"));
    if (!canManage(a, row.department)) return reply.code(403).send(problem(403, "forbidden", "You edit news for your own department."));
    const department = req.body?.department === undefined ? row.department : dept(req.body.department);
    if (!canManage(a, department)) return reply.code(403).send(problem(403, "forbidden", "You edit news for your own department."));
    await pool.query(
      `update ops_news set title = $2, body = $3, department = $4, staff_group = $5 where id = $1`,
      [row.id, String(req.body?.title ?? "").trim().slice(0, 140), sanitizeRichText(String(req.body?.body ?? "")).slice(0, 4000), department, String(req.body?.staff_group ?? "").slice(0, 40)],
    );
    return { ok: true };
  });

  f.post("/v1/workforce-desk/events", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const department = dept(req.body?.department);
    if (!canManage(a, department)) return reply.code(403).send(problem(403, "forbidden", "You post events for your own department."));
    const title = String(req.body?.title ?? "").trim().slice(0, 140);
    const starts = String(req.body?.starts_at ?? "");
    if (!title || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(starts)) return reply.code(422).send(problem(422, "validation", "Give the event a title and a start"));
    const row = (await pool.query(
      `insert into ops_appointment (tenant_id, property_id, title, body, location, starts_at, department, staff_group, created_by)
       values ($1,$2,$3,$4,$5,$6::timestamptz,$7,$8,$9) returning id`,
      [a.tenantId, a.propertyId, title, String(req.body?.body ?? "").slice(0, 2000), String(req.body?.location ?? "").slice(0, 120), starts, department, String(req.body?.staff_group ?? "").slice(0, 40), a.userId],
    )).rows[0];
    reply.code(201);
    return { id: row.id };
  });

  f.patch("/v1/workforce-desk/events/:id", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const row = (await pool.query(`select id, department from ops_appointment where id = $1 and property_id = $2`, [req.params.id, a.propertyId])).rows[0];
    if (!row) return reply.code(404).send(problem(404, "not_found", "No such event"));
    if (!canManage(a, row.department)) return reply.code(403).send(problem(403, "forbidden", "You edit events for your own department."));
    await pool.query(
      `update ops_appointment set title = $2, body = $3, location = $4, starts_at = coalesce($5::timestamptz, starts_at), department = $6, staff_group = $7 where id = $1`,
      [row.id, String(req.body?.title ?? "").trim().slice(0, 140), String(req.body?.body ?? "").slice(0, 2000), String(req.body?.location ?? "").slice(0, 120), /^\d{4}-\d{2}-\d{2}T/.test(String(req.body?.starts_at ?? "")) ? req.body.starts_at : null, dept(req.body?.department) || row.department, String(req.body?.staff_group ?? "").slice(0, 40)],
    );
    return { ok: true };
  });

  f.post("/v1/workforce-desk/payslips", { bodyLimit: 6_000_000 }, async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    if (!mayPublishRota(a.perms) && !a.perms.has("clock.manage")) return reply.code(403).send(problem(403, "forbidden", "Payroll files a payslip."));
    const userId = uuid(req.body?.user_id);
    const start = day(req.body?.period_start);
    const end = day(req.body?.period_end);
    const file = parseData(String(req.body?.data ?? ""), 4_000_000);
    if (!userId || !start || !end || !file || file.mime !== "application/pdf") return reply.code(422).send(problem(422, "validation", "Choose the person, the period and a PDF"));
    const row = (await pool.query(
      `insert into payslip (tenant_id, property_id, user_id, period_label, period_start, period_end, gross_pence, net_pence, summary, filename, mime, bytes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [a.tenantId, a.propertyId, userId, String(req.body?.period_label ?? `${start} to ${end}`).slice(0, 80), start, end, Number(req.body?.gross_pence) || 0, Number(req.body?.net_pence) || 0, String(req.body?.summary ?? "").slice(0, 400), String(req.body?.filename ?? "payslip.pdf").slice(0, 120), file.mime, file.bytes],
    )).rows[0];
    await notifyUsers(a.propertyId, [userId], "Payslip filed", String(req.body?.period_label ?? "A payslip is ready"), "/workforce/people/");
    reply.code(201);
    return { id: row.id };
  });

  f.get("/v1/workforce-desk/payslips/:id", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const row = (await pool.query(`select user_id, mime, bytes, filename from payslip where id = $1 and property_id = $2`, [req.params.id, a.propertyId])).rows[0];
    if (!row?.bytes) return reply.code(404).send(problem(404, "not_found", "No payslip file"));
    if (row.user_id !== a.userId && !mayPublishRota(a.perms) && !a.perms.has("clock.manage") && !mayApproveDepartment(a.perms, a.department, await userDept(a.propertyId, row.user_id))) {
      return reply.code(403).send(problem(403, "forbidden", "That payslip is not yours."));
    }
    reply.header("content-type", row.mime || "application/pdf").header("content-disposition", `inline; filename="${String(row.filename || "payslip.pdf").replace(/"/g, "")}"`);
    return reply.send(row.bytes);
  });

  f.get("/v1/workforce-desk/documents", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const userId = uuid(req.query?.user_id) ?? a.userId;
    if (userId !== a.userId && !mayPublishRota(a.perms) && !a.perms.has("clock.manage") && !mayApproveDepartment(a.perms, a.department, await userDept(a.propertyId, userId))) {
      return reply.code(403).send(problem(403, "forbidden", "You open documents for your own department."));
    }
    const items = (await pool.query(
      `select id, user_id, folder, kind, title, expires_at::text, (bytes is not null) as has_file, created_at
       from staff_document where property_id = $1 and user_id = $2 order by folder, title`,
      [a.propertyId, userId],
    )).rows;
    return { items };
  });

  f.post("/v1/workforce-desk/documents", { bodyLimit: 6_000_000 }, async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const userId = uuid(req.body?.user_id);
    if (!userId) return reply.code(422).send(problem(422, "validation", "Choose the person"));
    if (!mayPublishRota(a.perms) && !a.perms.has("clock.manage") && !mayApproveDepartment(a.perms, a.department, await userDept(a.propertyId, userId))) {
      return reply.code(403).send(problem(403, "forbidden", "You file documents for your own department."));
    }
    const file = req.body?.data ? parseData(String(req.body.data)) : null;
    if (req.body?.data && !file) return reply.code(422).send(problem(422, "validation", "Upload a PDF or a photo"));
    const title = String(req.body?.title ?? "").trim().slice(0, 140);
    if (!title) return reply.code(422).send(problem(422, "validation", "Name the document"));
    const row = (await pool.query(
      `insert into staff_document (tenant_id, property_id, user_id, kind, title, folder, mime, bytes, notes, uploaded_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [a.tenantId, a.propertyId, userId, String(req.body?.kind ?? "other").slice(0, 40), title, String(req.body?.folder ?? "General").slice(0, 80), file?.mime ?? "", file?.bytes ?? null, String(req.body?.notes ?? "").slice(0, 400), a.userId],
    )).rows[0];
    reply.code(201);
    return { id: row.id };
  });

  f.get("/v1/workforce-desk/documents/:id", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const row = (await pool.query(`select user_id, mime, bytes, title from staff_document where id = $1 and property_id = $2`, [req.params.id, a.propertyId])).rows[0];
    if (!row?.bytes) return reply.code(404).send(problem(404, "not_found", "No file on that document"));
    if (row.user_id !== a.userId && !mayPublishRota(a.perms) && !a.perms.has("clock.manage") && !mayApproveDepartment(a.perms, a.department, await userDept(a.propertyId, row.user_id))) {
      return reply.code(403).send(problem(403, "forbidden", "That document is not yours."));
    }
    reply.header("content-type", row.mime || "application/octet-stream").header("content-disposition", `inline; filename="${String(row.title).replace(/"/g, "")}"`);
    return reply.send(row.bytes);
  });

  f.get("/v1/workforce-desk/people/:id", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const id = uuid(req.params.id);
    if (!id) return reply.code(422).send(problem(422, "validation", "Choose a person"));
    if (id !== a.userId && !mayPublishRota(a.perms) && !a.perms.has("clock.manage") && !mayApproveDepartment(a.perms, a.department, await userDept(a.propertyId, id))) {
      return reply.code(403).send(problem(403, "forbidden", "You open profiles in your own department."));
    }
    const person = (await pool.query(
      `select u.id, u.display_name name, u.email, u.phone, u.preferred_language language, coalesce(d.code,'') department, coalesce(d.name,'') department_name, r.name role_name, h.designation, h.contracted_hours
       from app_user u left join membership m on m.user_id = u.id and m.property_id = $2
       left join role r on r.id = m.role_id left join department d on d.id = m.department_id
       left join staff_hr h on h.user_id = u.id where u.id = $1`,
      [id, a.propertyId],
    )).rows[0];
    if (!person) return reply.code(404).send(problem(404, "not_found", "No such person"));
    const pref = (await pool.query(`select email_notifications, digest from wf_digest_pref where user_id = $1`, [id])).rows[0];
    const payslips = (await pool.query(
      `select id, period_label, period_start::text, period_end::text, net_pence, summary, (bytes is not null) as has_file from payslip where user_id = $1 and property_id = $2 order by period_end desc`,
      [id, a.propertyId],
    )).rows;
    return { ...person, email_notifications: pref?.email_notifications !== false, payslips };
  });

  f.patch("/v1/workforce-desk/people/:id", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const id = uuid(req.params.id);
    if (!id) return reply.code(422).send(problem(422, "validation", "Choose a person"));
    const self = id === a.userId;
    if (!self && !mayPublishRota(a.perms) && !mayApproveDepartment(a.perms, a.department, await userDept(a.propertyId, id))) {
      return reply.code(403).send(problem(403, "forbidden", "You edit profiles in your own department."));
    }
    const language = ["en", "pl", "ro", "bg", "es"].includes(req.body?.language) ? req.body.language : "en";
    await pool.query(
      `update app_user set phone = $2, preferred_language = $3 where id = $1`,
      [id, String(req.body?.phone ?? "").slice(0, 40), language],
    );
    if (self || mayPublishRota(a.perms)) {
      await pool.query(
        `insert into wf_digest_pref (user_id, email_notifications) values ($1,$2)
         on conflict (user_id) do update set email_notifications = excluded.email_notifications`,
        [id, req.body?.email_notifications !== false],
      );
    }
    return { ok: true };
  });
}

function visible(a: Actor, rows: { department: string; staff_group: string }[]) {
  if (mayPublishRota(a.perms)) return rows;
  return rows.filter(row => !row.department || row.department === a.department).filter(row => !row.staff_group || row.staff_group === a.role);
}

async function userDept(propertyId: string, userId: string): Promise<string> {
  const row = (await pool.query(
    `select d.code from membership m left join department d on d.id = m.department_id where m.property_id = $1 and m.user_id = $2 limit 1`,
    [propertyId, userId],
  )).rows[0];
  return row?.code ?? "";
}

async function reportRows(a: Actor, query: any) {
  const from = day(query.from) ?? new Date().toISOString().slice(0, 10);
  const to = day(query.to) ?? from;
  const span = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1);
  const prevFrom = addDays(from, -span);
  const prevTo = addDays(from, -1);
  const department = dept(query.department);
  const userId = uuid(query.user_id);
  const group = String(query.group ?? "").slice(0, 40);
  const shiftType = String(query.shift_type ?? "").slice(0, 40);
  const status = ["draft", "published", "approved"].includes(query.status) ? query.status : "all";
  const subtract = query.subtract_breaks !== "0" && query.subtract_breaks !== "false";
  const days = String(query.days ?? "").split(",").map(n => Number(n)).filter(n => n >= 1 && n <= 7);
  const kind = ["hours", "shifts", "types", "timesheet"].includes(query.kind) ? query.kind : "hours";
  const shifts = (await pool.query(
    `select s.user_id, coalesce(u.display_name, 'Open') name, s.department, coalesce(r.name, '') as "group", s.shift_type,
            s.shift_date::text date, extract(isodow from s.shift_date)::int isodow, s.start_time::text start_time, s.end_time::text end_time,
            s.break_minutes, s.published, s.approved_at
     from rota_shift s left join app_user u on u.id = s.user_id
     left join membership m on m.user_id = s.user_id and m.property_id = s.property_id
     left join role r on r.id = m.role_id
     where s.property_id = $1 and s.shift_date between $2::date and $3::date
       and ($4 = '' or s.department = $4) and ($5::uuid is null or s.user_id = $5) and ($6 = '' or r.code = $6 or r.name = $6)
       and ($7 = '' or s.shift_type = $7)`,
    [a.propertyId, prevFrom, to, department, userId, group, shiftType],
  )).rows.filter((row: any) => {
    if (days.length && !days.includes(Number(row.isodow))) return false;
    if (status === "draft" && row.published) return false;
    if (status === "published" && !row.published) return false;
    if (status === "approved" && !row.approved_at) return false;
    return true;
  });
  const inRange = (row: any, start: string, end: string) => row.date >= start && row.date <= end;
  const hoursOf = (row: any) => shiftHours(row.start_time, row.end_time, subtract ? row.break_minutes : 0);
  if (kind === "types") {
    const bag = new Map<string, { count: number; hours: number }>();
    for (const row of shifts.filter((item: any) => inRange(item, from, to))) {
      const cur = bag.get(row.shift_type) ?? { count: 0, hours: 0 };
      bag.set(row.shift_type, { count: cur.count + 1, hours: Math.round((cur.hours + hoursOf(row)) * 10) / 10 });
    }
    return { kind, from, to, rows: [], types: [...bag.entries()].map(([shift_type, v]) => ({ shift_type, ...v })) };
  }
  if (kind === "timesheet") {
    const punches = (await pool.query(
      `select u.display_name name, c.clocked_in_at, c.clocked_out_at, c.break_minutes, c.approved_at
       from clock_record c join app_user u on u.id = c.user_id
       where c.property_id = $1 and c.clocked_in_at::date between $2::date and $3::date and ($4::uuid is null or c.user_id = $4)`,
      [a.propertyId, from, to, userId],
    )).rows;
    const rows = punches.map((row: any) => {
      const end = row.clocked_out_at ? new Date(row.clocked_out_at) : null;
      const raw = end ? (end.getTime() - new Date(row.clocked_in_at).getTime()) / 3600000 : 0;
      const hours = Math.round(Math.max(0, raw - (subtract ? (row.break_minutes || 0) / 60 : 0)) * 10) / 10;
      return { name: row.name, department: "", group: "", shifts: 1, hours, compare_hours: 0, status: row.approved_at ? "approved" : "open" };
    });
    return { kind, from, to, rows, types: [] };
  }
  const bag = new Map<string, { name: string; department: string; group: string; shifts: number; hours: number; compare_hours: number }>();
  for (const row of shifts) {
    const key = `${row.user_id}|${row.department}`;
    const cur = bag.get(key) ?? { name: row.name, department: row.department, group: row.group, shifts: 0, hours: 0, compare_hours: 0 };
    const hours = hoursOf(row);
    if (inRange(row, from, to)) { cur.shifts += 1; cur.hours = Math.round((cur.hours + hours) * 10) / 10; }
    else cur.compare_hours = Math.round((cur.compare_hours + hours) * 10) / 10;
    bag.set(key, cur);
  }
  return { kind, from, to, rows: [...bag.values()].filter(row => row.shifts || row.compare_hours), types: [] };
}
