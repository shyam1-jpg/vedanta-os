/**
 * Hotelkit-style handover desk. Creating stays with heads of department.
 * Other staff can read a handover they are allowed to see, and mark it read.
 * Templates are managed by the owner and the general manager.
 */
import type { FastifyInstance } from "fastify";
import { pool } from "./db.ts";
import { requireActor, problem, type Actor } from "./auth.ts";
import { parseDepartment } from "../../../domains/ops/board.ts";
import { HANDOVER_CATEGORIES, handoverCategory, mayOperate, mayPublish, sanitizeRichText } from "../../../domains/ops/suite.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return UUID.test(s) ? s : null;
}

function day(v: unknown): string | null {
  const s = String(v ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function when(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function ids(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : [];
  return [...new Set(raw.map(uuid).filter((x): x is string => !!x))].slice(0, 40);
}

async function reader(req: any, reply: any): Promise<Actor | null> {
  const a = await requireActor(req, reply, ["ADMIN", "STAFF"]);
  if (!a) return null;
  if (a.perms.has("group.read") || a.perms.has("cover.read") || mayPublish(a.perms) || mayOperate(a.perms)) return a;
  reply.code(403).send(problem(403, "forbidden", "You cannot open handovers"));
  return null;
}

function parseData(data: string): { mime: string; bytes: Buffer } | null {
  const m = /^data:(application\/pdf|image\/(?:jpeg|png|webp)|text\/plain);base64,([a-z0-9+/=\s]+)$/i.exec(String(data ?? "").trim());
  if (!m) return null;
  const bytes = Buffer.from(m[2].replace(/\s/g, ""), "base64");
  if (!bytes.length || bytes.length > 1_500_000) return null;
  return { mime: m[1].toLowerCase(), bytes };
}

const LIST = `
  h.id, h.title, h.body, h.category, h.visibility, h.status, h.archived,
  h.author_user_id, h.author_name, h.audience, h.audience_group, h.created_at, h.updated_at,
  h.publish_at, h.valid_from::text, h.valid_until::text, h.recipients_can_edit,
  exists(select 1 from ops_handover_ack k where k.handover_id = h.id and k.user_id = $2) read,
  coalesce((
    select string_agg(u.display_name, ', ' order by u.display_name)
    from ops_handover_recipient r join app_user u on u.id = r.user_id
    where r.handover_id = h.id
  ), case when h.audience_group is not null then h.audience_group else 'The house' end) recipients
`;

function seen(a: Actor, alias = "h"): string {
  if (mayPublish(a.perms)) return "(true or $3::text is null)";
  return `(
    ${alias}.author_user_id = $2
    or (
      ${alias}.status = 'live'
      and ${alias}.archived = false
      and (${alias}.publish_at is null or ${alias}.publish_at <= now())
      and (${alias}.valid_from is null or ${alias}.valid_from <= (timezone('Europe/London', now()))::date)
      and (${alias}.valid_until is null or ${alias}.valid_until >= (timezone('Europe/London', now()))::date)
      and (
        ${alias}.visibility = 'public'
        or exists (select 1 from ops_handover_recipient r where r.handover_id = ${alias}.id and r.user_id = $2)
        or ${alias}.audience_group = $3
      )
    )
  )`;
}

export default async function handoverDesk(f: FastifyInstance) {
  f.get("/v1/handover-desk", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const bucket = String(req.query?.bucket ?? "all");
    const person = uuid(req.query?.user);
    const group = String(req.query?.group ?? "").trim().toUpperCase();
    const from = day(req.query?.from);
    const to = day(req.query?.to);
    const categories = String(req.query?.categories ?? "").split(",").map(s => handoverCategory(s)).filter(Boolean);
    const q = String(req.query?.q ?? "").trim().slice(0, 80);
    const params: unknown[] = [a.propertyId, a.userId, a.department ?? ""];
    const where = ["h.property_id = $1", seen(a)];
    if (bucket === "by") where.push("h.author_user_id = $2 and h.archived = false");
    if (bucket === "for" || bucket === "with") where.push(`(exists (select 1 from ops_handover_recipient r where r.handover_id = h.id and r.user_id = $2) or h.audience_group = $3) and h.archived = false`);
    if (bucket === "commented") where.push(`exists (select 1 from ops_handover_comment c where c.handover_id = h.id and c.author_user_id = $2) and h.archived = false`);
    if (bucket === "unpublished") where.push("h.author_user_id = $2 and h.status = 'draft'");
    if (bucket === "archive") where.push("(h.author_user_id = $2 or exists (select 1 from ops_handover_recipient r where r.handover_id = h.id and r.user_id = $2)) and h.archived = true");
    if (bucket === "all" || !["by", "for", "with", "commented", "unpublished", "archive"].includes(bucket)) {
      where.push("h.archived = false");
      if (!mayPublish(a.perms)) where.push("(h.status = 'live' or h.author_user_id = $2)");
    }
    if (person) { params.push(person); where.push(`(h.author_user_id = $${params.length} or exists (select 1 from ops_handover_recipient r where r.handover_id = h.id and r.user_id = $${params.length}))`); }
    if (group && group !== "ALL") { params.push(group); where.push(`h.audience_group = $${params.length}`); }
    if (from) { params.push(from); where.push(`h.created_at::date >= $${params.length}::date`); }
    if (to) { params.push(to); where.push(`h.created_at::date <= $${params.length}::date`); }
    if (categories.length) { params.push(categories); where.push(`h.category = any($${params.length}::text[])`); }
    if (q) { params.push(`%${q.replace(/[%_]/g, "")}%`); where.push(`(h.title ilike $${params.length} or h.body ilike $${params.length} or h.author_name ilike $${params.length})`); }
    const items = (await pool.query(
      `select ${LIST} from ops_handover h where ${where.join(" and ")} order by h.updated_at desc nulls last, h.created_at desc limit 120`,
      params,
    )).rows;
    const recent = (await pool.query(
      `select distinct on (u.id) u.id, u.display_name name
       from ops_handover h
       join ops_handover_recipient r on r.handover_id = h.id
       join app_user u on u.id = r.user_id
       where h.property_id = $1 and h.author_user_id = $2
       order by u.id, h.created_at desc
       limit 6`,
      [a.propertyId, a.userId],
    )).rows;
    const saved = (await pool.query(`select payload from ops_saved_filter where user_id = $1 and kind = 'handover'`, [a.userId])).rows[0]?.payload ?? null;
    const templates = mayOperate(a.perms)
      ? (await pool.query(
        `select t.id, t.title, t.body_html, t.category_id, c.title category
         from ops_handover_template t
         left join ops_handover_template_category c on c.id = t.category_id
         where t.property_id = $1 order by t.title`,
        [a.propertyId],
      )).rows
      : [];
    const templateCategories = mayPublish(a.perms)
      ? (await pool.query(`select id, title from ops_handover_template_category where property_id = $1 order by title`, [a.propertyId])).rows
      : [];
    return {
      items: items.map(row => ({
        ...row,
        title: row.title || String(row.body ?? "").replace(/<[^>]+>/g, " ").trim().slice(0, 80) || "Handover",
        read: Boolean(row.read),
      })),
      categories: [...HANDOVER_CATEGORIES],
      recent,
      saved,
      templates,
      template_categories: templateCategories,
      can_operate: mayOperate(a.perms),
      can_publish: mayPublish(a.perms),
    };
  });

  f.put("/v1/handover-desk/filters", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    await pool.query(
      `insert into ops_saved_filter (user_id, kind, payload) values ($1, 'handover', $2::jsonb)
       on conflict (user_id, kind) do update set payload = excluded.payload`,
      [a.userId, JSON.stringify(payload)],
    );
    return { ok: true };
  });

  f.get("/v1/handover-desk/:id", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const row = (await pool.query(
      `select ${LIST} from ops_handover h where h.property_id = $1 and h.id = $4 and ${seen(a)}`,
      [a.propertyId, a.userId, a.department ?? "", req.params.id],
    )).rows[0];
    if (!row) return reply.code(404).send(problem(404, "not_found", "No such handover"));
    const recipients = (await pool.query(
      `select u.id, u.display_name name from ops_handover_recipient r join app_user u on u.id = r.user_id where r.handover_id = $1 order by u.display_name`,
      [row.id],
    )).rows;
    const comments = (await pool.query(
      `select c.id, c.body, c.author_name, c.created_at,
              coalesce(json_agg(json_build_object('id', f.id, 'filename', f.filename)) filter (where f.id is not null), '[]') files
       from ops_handover_comment c
       left join ops_handover_file f on f.comment_id = c.id
       where c.handover_id = $1
       group by c.id order by c.created_at`,
      [row.id],
    )).rows;
    const files = (await pool.query(
      `select id, filename from ops_handover_file where handover_id = $1 and comment_id is null order by created_at`,
      [row.id],
    )).rows;
    const involved = row.author_user_id === a.userId || recipients.some((r: { id: string }) => r.id === a.userId);
    return {
      ...row,
      title: row.title || "Handover",
      read: Boolean(row.read),
      recipients,
      comments,
      files,
      can_comment: mayOperate(a.perms),
      can_edit: mayPublish(a.perms) || row.author_user_id === a.userId || (row.recipients_can_edit && involved && mayOperate(a.perms)),
    };
  });

  f.post("/v1/handover-desk", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    if (!mayOperate(a.perms)) return reply.code(403).send(problem(403, "forbidden", "Only a head of department writes a handover. You can still mark one read."));
    const title = String(req.body?.title ?? "").trim().slice(0, 180);
    const body = sanitizeRichText(String(req.body?.body_html ?? req.body?.body ?? ""));
    if (!title) return reply.code(422).send(problem(422, "validation", "Give the handover a title"));
    if (!body.replace(/<[^>]+>/g, "").trim()) return reply.code(422).send(problem(422, "validation", "Write the handover"));
    const status = req.body?.status === "draft" ? "draft" : "live";
    const visibility = req.body?.visibility === "private" ? "private" : "public";
    const category = handoverCategory(req.body?.category);
    const group = req.body?.group ? parseDepartment(req.body.group, "HOUSE") : null;
    const recipientIds = ids(req.body?.recipient_ids);
    const audience = recipientIds.length ? "person" : group ? "group" : "shift";
    const row = (await pool.query(
      `insert into ops_handover (
         tenant_id, property_id, department, shift, for_date, body, author_user_id, author_name,
         audience, recipient_user_id, audience_group, title, category, visibility, status,
         publish_at, valid_from, valid_until, recipients_can_edit, updated_at
       ) values (
         $1,$2,'HOUSE','am',(timezone('Europe/London', now()))::date,$3,$4,$5,
         $6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now()
       ) returning id`,
      [
        a.tenantId, a.propertyId, body, a.userId, a.name, audience, recipientIds[0] ?? null, group, title, category,
        visibility, status, when(req.body?.publish_at), day(req.body?.valid_from), day(req.body?.valid_until),
        Boolean(req.body?.recipients_can_edit),
      ],
    )).rows[0];
    for (const id of recipientIds) {
      await pool.query(`insert into ops_handover_recipient (handover_id, user_id) values ($1,$2) on conflict do nothing`, [row.id, id]);
    }
    if (req.body?.save_template && mayPublish(a.perms)) {
      await pool.query(
        `insert into ops_handover_template (tenant_id, property_id, category_id, title, body_html, created_by)
         values ($1,$2,$3,$4,$5,$6)`,
        [a.tenantId, a.propertyId, uuid(req.body?.template_category_id), title, body, a.userId],
      );
    }
    reply.code(201);
    return { id: row.id };
  });

  f.post("/v1/handover-desk/:id/read", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const row = (await pool.query(
      `select h.id from ops_handover h where h.property_id = $1 and h.id = $4 and ${seen(a)}`,
      [a.propertyId, a.userId, a.department ?? "", req.params.id],
    )).rows[0];
    if (!row) return reply.code(404).send(problem(404, "not_found", "No such handover"));
    await pool.query(`insert into ops_handover_ack (handover_id, user_id) values ($1,$2) on conflict do nothing`, [row.id, a.userId]);
    return { ok: true };
  });

  f.post("/v1/handover-desk/:id/comments", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    if (!mayOperate(a.perms)) return reply.code(403).send(problem(403, "forbidden", "Only a head of department comments. You can mark the handover read."));
    const row = (await pool.query(
      `select h.id from ops_handover h where h.property_id = $1 and h.id = $4 and ${seen(a)}`,
      [a.propertyId, a.userId, a.department ?? "", req.params.id],
    )).rows[0];
    if (!row) return reply.code(404).send(problem(404, "not_found", "No such handover"));
    const body = String(req.body?.body ?? "").trim().slice(0, 4000);
    if (!body) return reply.code(422).send(problem(422, "validation", "Write a comment"));
    const comment = (await pool.query(
      `insert into ops_handover_comment (handover_id, author_user_id, author_name, body) values ($1,$2,$3,$4) returning id`,
      [row.id, a.userId, a.name, body],
    )).rows[0];
    await pool.query(`update ops_handover set updated_at = now() where id = $1`, [row.id]);
    reply.code(201);
    return { id: comment.id };
  });

  f.post("/v1/handover-desk/:id/files", { bodyLimit: 2_000_000 }, async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    if (!mayOperate(a.perms)) return reply.code(403).send(problem(403, "forbidden", "Only a head of department attaches a file."));
    const row = (await pool.query(`select id, author_user_id from ops_handover where property_id = $1 and id = $2`, [a.propertyId, req.params.id])).rows[0];
    if (!row) return reply.code(404).send(problem(404, "not_found", "No such handover"));
    const file = parseData(String(req.body?.data ?? ""));
    if (!file) return reply.code(422).send(problem(422, "validation", "Attach a PDF, text file or image under 1.5 MB"));
    const comment = uuid(req.body?.comment_id);
    const saved = (await pool.query(
      `insert into ops_handover_file (handover_id, comment_id, filename, mime, bytes, created_by)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [row.id, comment, String(req.body?.filename ?? "file").slice(0, 140), file.mime, file.bytes, a.userId],
    )).rows[0];
    reply.code(201);
    return { id: saved.id };
  });

  f.get("/v1/handover-files/:id", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const row = (await pool.query(
      `select f.filename, f.mime, f.bytes from ops_handover_file f
       join ops_handover h on h.id = f.handover_id
       where f.id = $1 and h.property_id = $2`,
      [req.params.id, a.propertyId],
    )).rows[0];
    if (!row) return reply.code(404).send(problem(404, "not_found", "No such file"));
    reply.header("content-type", row.mime).header("content-disposition", `attachment; filename="${String(row.filename).replace(/"/g, "")}"`);
    return reply.send(row.bytes);
  });

  f.post("/v1/handover-desk/archive", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    if (!mayOperate(a.perms)) return reply.code(403).send(problem(403, "forbidden", "Only a head of department archives a handover."));
    const list = ids(req.body?.ids);
    if (!list.length) return reply.code(422).send(problem(422, "validation", "Choose the handovers to archive"));
    await pool.query(
      `update ops_handover set archived = true, updated_at = now()
       where property_id = $1 and id = any($2::uuid[]) and (author_user_id = $3 or $4)`,
      [a.propertyId, list, a.userId, mayPublish(a.perms)],
    );
    return { ok: true };
  });

  f.post("/v1/handover-templates", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    if (!mayPublish(a.perms)) return reply.code(403).send(problem(403, "forbidden", "Only the owner or a general manager manages templates."));
    const title = String(req.body?.title ?? "").trim().slice(0, 180);
    if (!title) return reply.code(422).send(problem(422, "validation", "Name the template"));
    const row = (await pool.query(
      `insert into ops_handover_template (tenant_id, property_id, category_id, title, body_html, created_by)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [a.tenantId, a.propertyId, uuid(req.body?.category_id), title, sanitizeRichText(String(req.body?.body_html ?? "")), a.userId],
    )).rows[0];
    reply.code(201);
    return { id: row.id };
  });

  f.post("/v1/handover-template-categories", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    if (!mayPublish(a.perms)) return reply.code(403).send(problem(403, "forbidden", "Only the owner or a general manager manages template categories."));
    const title = String(req.body?.title ?? "").trim().slice(0, 120);
    if (!title) return reply.code(422).send(problem(422, "validation", "Name the category"));
    const row = (await pool.query(
      `insert into ops_handover_template_category (tenant_id, property_id, title) values ($1,$2,$3)
       on conflict (property_id, title) do update set title = excluded.title returning id`,
      [a.tenantId, a.propertyId, title],
    )).rows[0];
    reply.code(201);
    return { id: row.id };
  });

  f.delete("/v1/handover-templates/:id", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    if (!mayPublish(a.perms)) return reply.code(403).send(problem(403, "forbidden", "Only the owner or a general manager manages templates."));
    await pool.query(`delete from ops_handover_template where property_id = $1 and id = $2`, [a.propertyId, req.params.id]);
    return { ok: true };
  });
}
