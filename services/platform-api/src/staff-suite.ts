/**
 * Staff desk: handbook, news, ideas, calendar, complaints, people, home feed,
 * housekeeping plan. Read is open to the house. Publishing is content.publish
 * only — the owner and general manager. Staff may confirm they have read.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { pool } from "./db.ts";
import { requireActor, problem, type Actor } from "./auth.ts";
import {
  audienceAllows,
  buildTextPdf,
  canMoveComplaint,
  mayPublish,
  parseComplaintStatus,
  parseIdeaStatus,
  richTextToPlain,
  sanitizeRichText,
  type ComplaintStatus,
} from "../../../domains/ops/suite.ts";

const assetsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../db/assets");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return UUID.test(s) ? s : null;
}

function clean(v: unknown, max: number): string {
  return String(v ?? "").trim().slice(0, max);
}

function day(v: unknown): string | null {
  const s = String(v ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function tags(v: unknown, upper = false): string[] {
  const raw = Array.isArray(v) ? v : String(v ?? "").split(",");
  return [...new Set(raw.map(x => {
    const s = String(x).trim().slice(0, 40);
    return upper ? s.toUpperCase() : s;
  }).filter(Boolean))].slice(0, 20);
}

function parseData(data: string, max: number): { mime: string; bytes: Buffer } | null {
  const m = /^data:([\w.+-]+\/[\w.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(String(data ?? "").trim());
  if (!m) return null;
  const bytes = Buffer.from(m[2].replace(/\s/g, ""), "base64");
  if (!bytes.length || bytes.length > max) return null;
  return { mime: m[1].toLowerCase(), bytes };
}

async function reader(req: any, reply: any): Promise<Actor | null> {
  const a = await requireActor(req, reply, ["ADMIN", "STAFF"]);
  if (!a) return null;
  if (a.perms.has("group.read") || a.perms.has("cover.read") || a.perms.has("sop.read") || mayPublish(a.perms)) return a;
  reply.code(403).send(problem(403, "forbidden", "You cannot open the staff desk"));
  return null;
}

function publishing(a: Actor): boolean {
  return mayPublish(a.perms);
}

function denyPublish(a: Actor, reply: any): boolean {
  if (publishing(a)) return false;
  reply.code(403).send(problem(403, "forbidden", "Only the owner or an admin can publish this. Staff can read it."));
  return true;
}

function canSee(a: Actor, audience: string[] | null): boolean {
  if (publishing(a)) return true;
  return audienceAllows(audience, { department: a.department, role: a.role });
}

async function activity(a: Actor, kind: string, title: string, body: string, href: string) {
  await pool.query(
    `insert into ops_activity (tenant_id, property_id, kind, title, body, href, actor_user_id, actor_name)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [a.tenantId, a.propertyId, kind, title.slice(0, 200), body.slice(0, 500), href, a.userId, a.name],
  );
  await pool.query(
    `insert into ops_notification (tenant_id, property_id, title, body, href, audience)
     values ($1,$2,$3,$4,$5,'{}')`,
    [a.tenantId, a.propertyId, title.slice(0, 200), body.slice(0, 300), href],
  );
}

function assetBytes(key: string | null): Buffer | null {
  if (!key) return null;
  const name = key.split(/[/\\]/).pop() ?? "";
  if (!/^[\w.\-]+$/.test(name)) return null;
  const path = join(assetsDir, name);
  if (!path.startsWith(assetsDir) || !existsSync(path)) return null;
  return readFileSync(path);
}

export default async function staffSuite(f: FastifyInstance) {
  f.get("/v1/handbook", async (req, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const chapters = (await pool.query(
      `select id, parent_id, title, sort_order from handbook_chapter where property_id=$1 order by sort_order, title`,
      [a.propertyId],
    )).rows;
    const articles = (await pool.query(
      `select a.id, a.chapter_id, a.title, a.keywords, a.audience, a.review_on::text, a.status, a.version, a.updated_at,
              (select count(*)::int from handbook_sign s where s.article_id=a.id and s.version=a.version) signed_count,
              exists(select 1 from handbook_sign s where s.article_id=a.id and s.user_id=$2 and s.version=a.version) signed
       from handbook_article a where a.property_id=$1 order by a.title`,
      [a.propertyId, a.userId],
    )).rows.filter((row: any) => (publishing(a) || row.status === "live") && canSee(a, row.audience));
    const visibleChapters = publishing(a)
      ? chapters
      : chapters.filter((c: any) => articles.some((art: any) => art.chapter_id === c.id));
    return { chapters: visibleChapters, articles, can_publish: publishing(a) };
  });

  f.post("/v1/handbook/chapters", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a || denyPublish(a, reply)) return;
    const title = clean(req.body?.title, 160);
    if (!title) return reply.code(422).send(problem(422, "validation", "Name the chapter"));
    const parent = uuid(req.body?.parent_id);
    const r = await pool.query(
      `insert into handbook_chapter (tenant_id, property_id, parent_id, title, sort_order, created_by)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [a.tenantId, a.propertyId, parent, title, Number(req.body?.sort_order) || 0, a.userId],
    );
    reply.code(201);
    return { id: r.rows[0].id };
  });

  f.patch("/v1/handbook/chapters/:id", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a || denyPublish(a, reply)) return;
    const title = clean(req.body?.title, 160);
    if (!title) return reply.code(422).send(problem(422, "validation", "Name the chapter"));
    const r = await pool.query(
      `update handbook_chapter set title=$3, parent_id=$4 where property_id=$1 and id=$2 returning id`,
      [a.propertyId, req.params.id, title, uuid(req.body?.parent_id)],
    );
    if (!r.rowCount) return reply.code(404).send(problem(404, "not_found", "No such chapter"));
    return { ok: true };
  });

  f.post("/v1/handbook/articles", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a || denyPublish(a, reply)) return;
    const title = clean(req.body?.title, 180);
    const chapter = uuid(req.body?.chapter_id);
    if (!title || !chapter) return reply.code(422).send(problem(422, "validation", "Choose a chapter and a title"));
    const owned = await pool.query(`select id from handbook_chapter where id=$1 and property_id=$2`, [chapter, a.propertyId]);
    if (!owned.rowCount) return reply.code(404).send(problem(404, "not_found", "No such chapter"));
    const body = sanitizeRichText(String(req.body?.body_html ?? req.body?.body ?? ""));
    const keywords = tags(req.body?.keywords);
    const audience = tags(req.body?.audience, true);
    const review = day(req.body?.review_on);
    const r = await pool.query(
      `insert into handbook_article (tenant_id, property_id, chapter_id, title, body_html, keywords, audience, review_on, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) returning id, version`,
      [a.tenantId, a.propertyId, chapter, title, body, keywords, audience, review, a.userId],
    );
    await pool.query(
      `insert into handbook_version (article_id, version, title, body_html, keywords, edited_by, note)
       values ($1,1,$2,$3,$4,$5,'Opened')`,
      [r.rows[0].id, title, body, keywords, a.userId],
    );
    await activity(a, "handbook", title, "Handbook article published", "/handbook/");
    reply.code(201);
    return { id: r.rows[0].id };
  });

  f.get("/v1/handbook/articles/:id", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const row = (await pool.query(
      `select a.*, a.review_on::text review_on,
              exists(select 1 from handbook_sign s where s.article_id=a.id and s.user_id=$3 and s.version=a.version) signed
       from handbook_article a where a.property_id=$1 and a.id=$2`,
      [a.propertyId, req.params.id, a.userId],
    )).rows[0];
    if (!row || (!publishing(a) && row.status !== "live") || !canSee(a, row.audience)) {
      return reply.code(404).send(problem(404, "not_found", "No such article"));
    }
    const versions = (await pool.query(
      `select version, title, edited_at, note from handbook_version where article_id=$1 order by version desc`,
      [row.id],
    )).rows;
    const attachments = (await pool.query(
      `select id, kind, filename, mime, url, created_at from handbook_attachment where article_id=$1 order by created_at`,
      [row.id],
    )).rows;
    const signers = publishing(a)
      ? (await pool.query(
        `select u.display_name name, s.signed_at from handbook_sign s join app_user u on u.id=s.user_id
         where s.article_id=$1 and s.version=$2 order by s.signed_at`,
        [row.id, row.version],
      )).rows
      : [];
    return {
      id: row.id, chapter_id: row.chapter_id, title: row.title, body_html: row.body_html,
      keywords: row.keywords, audience: row.audience, review_on: row.review_on, status: row.status,
      version: row.version, updated_at: row.updated_at, signed: row.signed, versions, attachments, signers,
      can_publish: publishing(a),
    };
  });

  f.patch("/v1/handbook/articles/:id", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a || denyPublish(a, reply)) return;
    const row = (await pool.query(`select * from handbook_article where property_id=$1 and id=$2`, [a.propertyId, req.params.id])).rows[0];
    if (!row) return reply.code(404).send(problem(404, "not_found", "No such article"));
    const title = req.body?.title != null ? clean(req.body.title, 180) : row.title;
    const body = req.body?.body_html != null || req.body?.body != null
      ? sanitizeRichText(String(req.body.body_html ?? req.body.body ?? ""))
      : row.body_html;
    const keywords = req.body?.keywords != null ? tags(req.body.keywords) : row.keywords;
    const audience = req.body?.audience != null ? tags(req.body.audience, true) : row.audience;
    const review = req.body?.review_on !== undefined ? day(req.body.review_on) : row.review_on;
    const status = ["draft", "live", "archived"].includes(req.body?.status) ? req.body.status : row.status;
    const changed = title !== row.title || body !== row.body_html || JSON.stringify(keywords) !== JSON.stringify(row.keywords);
    const version = changed ? row.version + 1 : row.version;
    await pool.query(
      `update handbook_article set title=$3, body_html=$4, keywords=$5, audience=$6, review_on=$7, status=$8, version=$9, updated_by=$10, updated_at=now()
       where id=$1 and property_id=$2`,
      [row.id, a.propertyId, title, body, keywords, audience, review, status, version, a.userId],
    );
    if (changed) {
      await pool.query(
        `insert into handbook_version (article_id, version, title, body_html, keywords, edited_by, note)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [row.id, version, title, body, keywords, a.userId, clean(req.body?.note, 200) || "Updated"],
      );
    }
    return { ok: true, version };
  });

  f.post("/v1/handbook/articles/:id/sign", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const row = (await pool.query(`select id, version, status, audience from handbook_article where property_id=$1 and id=$2`, [a.propertyId, req.params.id])).rows[0];
    if (!row || row.status !== "live" || !canSee(a, row.audience)) return reply.code(404).send(problem(404, "not_found", "No such article"));
    await pool.query(
      `insert into handbook_sign (article_id, user_id, version) values ($1,$2,$3) on conflict do nothing`,
      [row.id, a.userId, row.version],
    );
    return { ok: true, version: row.version };
  });

  f.post("/v1/handbook/articles/:id/attachments", { bodyLimit: 3_000_000 }, async (req: any, reply) => {
    const a = await reader(req, reply); if (!a || denyPublish(a, reply)) return;
    const row = (await pool.query(`select id from handbook_article where property_id=$1 and id=$2`, [a.propertyId, req.params.id])).rows[0];
    if (!row) return reply.code(404).send(problem(404, "not_found", "No such article"));
    const kind = String(req.body?.kind ?? "").toLowerCase();
    if (kind === "video") {
      const url = clean(req.body?.url, 400);
      if (!/^https?:\/\//i.test(url)) return reply.code(422).send(problem(422, "validation", "Give a video link starting with https"));
      const r = await pool.query(
        `insert into handbook_attachment (article_id, tenant_id, property_id, kind, filename, url, created_by)
         values ($1,$2,$3,'video',$4,$5,$6) returning id`,
        [row.id, a.tenantId, a.propertyId, clean(req.body?.filename, 120) || "Video", url, a.userId],
      );
      reply.code(201);
      return { id: r.rows[0].id };
    }
    if (kind !== "pdf" && kind !== "image") return reply.code(422).send(problem(422, "validation", "Attach a PDF, an image, or a video link"));
    const file = parseData(String(req.body?.data ?? ""), 2_000_000);
    if (!file) return reply.code(422).send(problem(422, "validation", "The file could not be read"));
    if (kind === "pdf" && file.mime !== "application/pdf") return reply.code(422).send(problem(422, "validation", "That file is not a PDF"));
    if (kind === "image" && !file.mime.startsWith("image/")) return reply.code(422).send(problem(422, "validation", "That file is not an image"));
    const r = await pool.query(
      `insert into handbook_attachment (article_id, tenant_id, property_id, kind, filename, mime, bytes, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [row.id, a.tenantId, a.propertyId, kind, clean(req.body?.filename, 160) || kind, file.mime, file.bytes, a.userId],
    );
    reply.code(201);
    return { id: r.rows[0].id };
  });

  f.get("/v1/handbook/attachments/:id", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const row = (await pool.query(
      `select x.*, art.audience, art.status from handbook_attachment x
       join handbook_article art on art.id=x.article_id
       where x.property_id=$1 and x.id=$2`,
      [a.propertyId, req.params.id],
    )).rows[0];
    if (!row || (!publishing(a) && row.status !== "live") || !canSee(a, row.audience)) {
      return reply.code(404).send(problem(404, "not_found", "No such file"));
    }
    if (row.kind === "video" && row.url) return reply.redirect(row.url);
    const bytes: Buffer | null = row.bytes ?? assetBytes(row.storage_key);
    if (!bytes) return reply.code(404).send(problem(404, "not_found", "The file is not on this server"));
    reply.header("content-type", row.mime || "application/octet-stream");
    reply.header("content-disposition", `inline; filename="${String(row.filename).replace(/"/g, "")}"`);
    return reply.send(bytes);
  });

  f.get("/v1/handbook/articles/:id/pdf", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const row = (await pool.query(`select * from handbook_article where property_id=$1 and id=$2`, [a.propertyId, req.params.id])).rows[0];
    if (!row || (!publishing(a) && row.status !== "live") || !canSee(a, row.audience)) {
      return reply.code(404).send(problem(404, "not_found", "No such article"));
    }
    const files = (await pool.query(`select filename, kind from handbook_attachment where article_id=$1`, [row.id])).rows
      .map((x: { filename: string; kind: string }) => `${x.kind}: ${x.filename}`).join("\n");
    const text = `${richTextToPlain(row.body_html)}${files ? `\n\nAttachments\n${files}` : ""}`;
    const pdf = buildTextPdf(row.title, text || row.title);
    reply.header("content-type", "application/pdf");
    reply.header("content-disposition", `attachment; filename="handbook.pdf"`);
    return reply.send(Buffer.from(pdf));
  });

  f.get("/v1/news", async (req, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const rows = (await pool.query(
      `select n.id, n.title, n.body, n.audience, n.author_name, n.created_at,
              exists(select 1 from ops_news_read r where r.news_id=n.id and r.user_id=$2) read
       from ops_news n where n.property_id=$1 order by n.created_at desc limit 100`,
      [a.propertyId, a.userId],
    )).rows.filter((row: any) => canSee(a, row.audience));
    return { items: rows, can_publish: publishing(a) };
  });

  f.post("/v1/news", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a || denyPublish(a, reply)) return;
    const title = clean(req.body?.title, 180);
    const body = clean(req.body?.body, 8000);
    if (!title || !body) return reply.code(422).send(problem(422, "validation", "Write the announcement"));
    const audience = tags(req.body?.audience, true);
    const r = await pool.query(
      `insert into ops_news (tenant_id, property_id, title, body, audience, author_user_id, author_name)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [a.tenantId, a.propertyId, title, body, audience, a.userId, a.name],
    );
    await activity(a, "news", title, body, "/news/");
    reply.code(201);
    return { id: r.rows[0].id };
  });

  f.post("/v1/news/:id/read", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const row = (await pool.query(`select id, audience from ops_news where property_id=$1 and id=$2`, [a.propertyId, req.params.id])).rows[0];
    if (!row || !canSee(a, row.audience)) return reply.code(404).send(problem(404, "not_found", "No such announcement"));
    await pool.query(`insert into ops_news_read (news_id, user_id) values ($1,$2) on conflict do nothing`, [row.id, a.userId]);
    return { ok: true };
  });

  f.get("/v1/ideas", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const status = clean(req.query?.status, 20);
    const category = clean(req.query?.category, 40);
    const rows = (await pool.query(
      `select i.id, i.title, i.body, i.category, i.status, i.author_name, i.created_at, i.updated_at
       from ops_idea i
       where i.property_id=$1 and ($2='' or i.status=$2) and ($3='' or i.category=$3)
       order by i.created_at desc limit 200`,
      [a.propertyId, status, category],
    )).rows;
    const comments = rows.length
      ? (await pool.query(
        `select id, idea_id, body, author_name, created_at from ops_idea_comment where property_id=$1 and idea_id = any($2::uuid[]) order by created_at`,
        [a.propertyId, rows.map((r: { id: string }) => r.id)],
      )).rows
      : [];
    return {
      items: rows.map((idea: any) => ({ ...idea, comments: comments.filter((c: any) => c.idea_id === idea.id) })),
      can_publish: publishing(a),
    };
  });

  f.post("/v1/ideas", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a || denyPublish(a, reply)) return;
    const title = clean(req.body?.title, 180);
    if (!title) return reply.code(422).send(problem(422, "validation", "Name the idea"));
    const r = await pool.query(
      `insert into ops_idea (tenant_id, property_id, title, body, category, status, author_user_id, author_name)
       values ($1,$2,$3,$4,$5,'new',$6,$7) returning id`,
      [a.tenantId, a.propertyId, title, clean(req.body?.body, 4000), clean(req.body?.category, 40) || "General", a.userId, a.name],
    );
    await activity(a, "idea", title, clean(req.body?.body, 240), "/ideas/");
    reply.code(201);
    return { id: r.rows[0].id };
  });

  f.patch("/v1/ideas/:id", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a || denyPublish(a, reply)) return;
    const status = parseIdeaStatus(req.body?.status, "new");
    const r = await pool.query(
      `update ops_idea set status=$3, category=coalesce($4, category), updated_at=now() where property_id=$1 and id=$2 returning id`,
      [a.propertyId, req.params.id, status, req.body?.category != null ? clean(req.body.category, 40) : null],
    );
    if (!r.rowCount) return reply.code(404).send(problem(404, "not_found", "No such idea"));
    return { ok: true, status };
  });

  f.post("/v1/ideas/:id/comments", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a || denyPublish(a, reply)) return;
    const body = clean(req.body?.body, 2000);
    if (!body) return reply.code(422).send(problem(422, "validation", "Write the comment"));
    const idea = await pool.query(`select id from ops_idea where property_id=$1 and id=$2`, [a.propertyId, req.params.id]);
    if (!idea.rowCount) return reply.code(404).send(problem(404, "not_found", "No such idea"));
    const r = await pool.query(
      `insert into ops_idea_comment (idea_id, tenant_id, property_id, body, author_user_id, author_name)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [req.params.id, a.tenantId, a.propertyId, body, a.userId, a.name],
    );
    reply.code(201);
    return { id: r.rows[0].id };
  });

  f.get("/v1/calendar", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const from = day(req.query?.from) ?? new Date().toISOString().slice(0, 10);
    const to = day(req.query?.to) ?? new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10);
    const appointments = (await pool.query(
      `select id, title, body, location, starts_at, ends_at, audience, created_at
       from ops_appointment where property_id=$1 and starts_at < ($3::date + 1) and coalesce(ends_at, starts_at) >= $2::date
       order by starts_at`,
      [a.propertyId, from, to],
    )).rows.filter((row: any) => canSee(a, row.audience));
    const retreats = (await pool.query(
      `select id, name, organisation, status, arrival_date::text arrival, departure_date::text departure, expected_guests
       from booking_group
       where property_id=$1 and status <> 'CANCELLED' and arrival_date <= $3::date and departure_date >= $2::date
       order by arrival_date, name`,
      [a.propertyId, from, to],
    )).rows;
    return { from, to, appointments, retreats, can_publish: publishing(a) };
  });

  f.post("/v1/calendar", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a || denyPublish(a, reply)) return;
    const title = clean(req.body?.title, 180);
    const starts = new Date(String(req.body?.starts_at ?? ""));
    if (!title || Number.isNaN(starts.getTime())) return reply.code(422).send(problem(422, "validation", "Give the event a title and a start"));
    const ends = req.body?.ends_at ? new Date(String(req.body.ends_at)) : null;
    const r = await pool.query(
      `insert into ops_appointment (tenant_id, property_id, title, body, location, starts_at, ends_at, audience, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [a.tenantId, a.propertyId, title, clean(req.body?.body, 4000), clean(req.body?.location, 120), starts, ends && !Number.isNaN(ends.getTime()) ? ends : null, tags(req.body?.audience, true), a.userId],
    );
    await activity(a, "calendar", title, clean(req.body?.location, 120), "/calendar/");
    reply.code(201);
    return { id: r.rows[0].id };
  });

  f.patch("/v1/calendar/:id", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a || denyPublish(a, reply)) return;
    const title = clean(req.body?.title, 180);
    if (!title) return reply.code(422).send(problem(422, "validation", "Give the event a title"));
    const starts = new Date(String(req.body?.starts_at ?? ""));
    if (Number.isNaN(starts.getTime())) return reply.code(422).send(problem(422, "validation", "Give the event a start"));
    const ends = req.body?.ends_at ? new Date(String(req.body.ends_at)) : null;
    const r = await pool.query(
      `update ops_appointment set title=$3, body=$4, location=$5, starts_at=$6, ends_at=$7, audience=$8
       where property_id=$1 and id=$2 returning id`,
      [a.propertyId, req.params.id, title, clean(req.body?.body, 4000), clean(req.body?.location, 120), starts, ends && !Number.isNaN(ends.getTime()) ? ends : null, tags(req.body?.audience, true)],
    );
    if (!r.rowCount) return reply.code(404).send(problem(404, "not_found", "No such event"));
    return { ok: true };
  });

  f.delete("/v1/calendar/:id", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a || denyPublish(a, reply)) return;
    const r = await pool.query(`delete from ops_appointment where property_id=$1 and id=$2`, [a.propertyId, req.params.id]);
    if (!r.rowCount) return reply.code(404).send(problem(404, "not_found", "No such event"));
    return { ok: true };
  });

  f.get("/v1/complaints", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const status = clean(req.query?.status, 20);
    const rows = (await pool.query(
      `select c.id, c.title, c.description, c.status, c.severity, c.department, c.guest_name, c.room_label, c.resolution, c.created_at, c.resolved_at
       from guest_complaint c
       where c.property_id=$1 and ($2='' or c.status=$2)
       order by c.created_at desc limit 200`,
      [a.propertyId, status],
    )).rows;
    return { items: rows, can_write: publishing(a) || a.perms.has("guest.write") };
  });

  f.post("/v1/complaints", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    if (!publishing(a) && !a.perms.has("guest.write")) {
      return reply.code(403).send(problem(403, "forbidden", "Only the desk or an admin records a complaint"));
    }
    const description = clean(req.body?.description, 4000);
    if (!description) return reply.code(422).send(problem(422, "validation", "Write what happened"));
    const severity = ["minor", "moderate", "serious", "critical"].includes(req.body?.severity) ? req.body.severity : "minor";
    const r = await pool.query(
      `insert into guest_complaint (tenant_id, property_id, severity, department, title, description, guest_name, room_label, status, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'open',$9) returning id`,
      [a.tenantId, a.propertyId, severity, clean(req.body?.department, 40) || null, clean(req.body?.title, 180), description, clean(req.body?.guest_name, 120), clean(req.body?.room_label, 40), a.userId],
    );
    reply.code(201);
    return { id: r.rows[0].id };
  });

  f.post("/v1/complaints/:id/status", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    if (!publishing(a) && !a.perms.has("guest.write")) {
      return reply.code(403).send(problem(403, "forbidden", "Only the desk or an admin updates a complaint"));
    }
    const row = (await pool.query(`select id, status from guest_complaint where property_id=$1 and id=$2`, [a.propertyId, req.params.id])).rows[0];
    if (!row) return reply.code(404).send(problem(404, "not_found", "No such complaint"));
    const next = parseComplaintStatus(req.body?.status, row.status);
    if (!canMoveComplaint(row.status as ComplaintStatus, next)) {
      return reply.code(409).send(problem(409, "invalid_transition", `Cannot move a ${row.status} complaint to ${next}`));
    }
    const resolution = clean(req.body?.resolution, 2000);
    await pool.query(
      `update guest_complaint set status=$3, resolution=coalesce(nullif($4,''), resolution),
         resolved_at=case when $3 in ('resolved','closed') then coalesce(resolved_at, now()) else resolved_at end,
         resolved_by=case when $3 in ('resolved','closed') then $5 else resolved_by end
       where id=$1 and property_id=$2`,
      [row.id, a.propertyId, next, resolution, a.userId],
    );
    return { ok: true, status: next };
  });

  f.get("/v1/staff/directory", async (req, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const rows = (await pool.query(
      `select distinct on (u.id) u.id, u.display_name name, u.email, u.phone, u.job_title, u.birthday::text birthday, u.status,
              r.code role, r.name role_name, d.code department, d.name department_name
       from app_user u
       join membership m on m.user_id=u.id and m.property_id=$1
       join role r on r.id=m.role_id
       left join department d on d.id=m.department_id
       where u.tenant_id=$2 and u.status <> 'LEFT'
       order by u.id, r.name`,
      [a.propertyId, a.tenantId],
    )).rows.sort((x: { name: string }, y: { name: string }) => x.name.localeCompare(y.name));
    return { items: rows, can_edit: publishing(a) || a.perms.has("user.manage") };
  });

  f.patch("/v1/staff/directory/:id", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    if (!publishing(a) && !a.perms.has("user.manage")) {
      return reply.code(403).send(problem(403, "forbidden", "Only an admin updates the directory"));
    }
    const birthday = req.body?.birthday === "" || req.body?.birthday == null ? null : day(req.body.birthday);
    if (req.body?.birthday && !birthday) return reply.code(422).send(problem(422, "validation", "Birthday needs a real date"));
    const r = await pool.query(
      `update app_user set phone=$3, job_title=$4, birthday=$5 where id=$2 and tenant_id=$1 returning id`,
      [a.tenantId, req.params.id, clean(req.body?.phone, 40) || null, clean(req.body?.job_title, 80) || null, birthday],
    );
    if (!r.rowCount) return reply.code(404).send(problem(404, "not_found", "No such person"));
    return { ok: true };
  });

  f.get("/v1/feed", async (req, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const activityRows = (await pool.query(
      `select id, kind, title, body, href, actor_name, created_at from ops_activity where property_id=$1 order by created_at desc limit 40`,
      [a.propertyId],
    )).rows;
    const moments = (await pool.query(
      `select id, body, author_name, created_at from ops_moment where property_id=$1 order by created_at desc limit 20`,
      [a.propertyId],
    )).rows;
    const notifications = (await pool.query(
      `select n.id, n.title, n.body, n.href, n.audience, n.created_at,
              exists(select 1 from ops_notification_read r where r.notification_id=n.id and r.user_id=$2) read
       from ops_notification n where n.property_id=$1 order by n.created_at desc limit 20`,
      [a.propertyId, a.userId],
    )).rows.filter((row: any) => canSee(a, row.audience));
    const people = (await pool.query(
      `select distinct u.display_name name, u.birthday::text birthday
       from app_user u join membership m on m.user_id=u.id and m.property_id=$1
       where u.birthday is not null and u.status='ACTIVE'`,
      [a.propertyId],
    )).rows;
    const today = new Date();
    const birthdays = people.flatMap((p: { name: string; birthday: string }) => {
      const [, month, date] = p.birthday.split("-").map(Number);
      if (!month || !date) return [];
      const when = new Date(today.getFullYear(), month - 1, date);
      if (when < new Date(today.getFullYear(), today.getMonth(), today.getDate())) when.setFullYear(when.getFullYear() + 1);
      const days = Math.round((when.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000);
      return days <= 14 ? [{ name: p.name, on: when.toISOString().slice(0, 10), days }] : [];
    }).sort((x, y) => x.days - y.days);
    return { activity: activityRows, moments, notifications, birthdays, can_publish: publishing(a) };
  });

  f.post("/v1/feed/moments", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a || denyPublish(a, reply)) return;
    const body = clean(req.body?.body, 2000);
    if (!body) return reply.code(422).send(problem(422, "validation", "Write the moment"));
    const r = await pool.query(
      `insert into ops_moment (tenant_id, property_id, body, author_user_id, author_name) values ($1,$2,$3,$4,$5) returning id`,
      [a.tenantId, a.propertyId, body, a.userId, a.name],
    );
    await activity(a, "moment", "A moment from the house", body, "/feed/");
    reply.code(201);
    return { id: r.rows[0].id };
  });

  f.post("/v1/feed/notifications/:id/read", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const row = await pool.query(`select id from ops_notification where property_id=$1 and id=$2`, [a.propertyId, req.params.id]);
    if (!row.rowCount) return reply.code(404).send(problem(404, "not_found", "No such notice"));
    await pool.query(`insert into ops_notification_read (notification_id, user_id) values ($1,$2) on conflict do nothing`, [req.params.id, a.userId]);
    return { ok: true };
  });

  f.get("/v1/housekeeping/plan", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const date = day(req.query?.date) ?? new Date().toISOString().slice(0, 10);
    const rows = (await pool.query(
      `select r.number, r.section, a.occupancy, a.clean_type, a.assignee_user_id, u.display_name assignee_name
       from hk_assignment a
       join room r on r.id=a.room_id
       left join app_user u on u.id=a.assignee_user_id
       where a.property_id=$1 and a.on_date=$2
       order by r.section, r.number`,
      [a.propertyId, date],
    )).rows;
    return { date, items: rows, can_plan: publishing(a) || a.perms.has("room.oos.set") };
  });

  f.put("/v1/housekeeping/plan", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    if (!publishing(a) && !a.perms.has("room.oos.set")) {
      return reply.code(403).send(problem(403, "forbidden", "Only a housekeeping supervisor or an admin sets the room plan"));
    }
    const date = day(req.body?.date);
    const rooms = Array.isArray(req.body?.rooms) ? req.body.rooms : [];
    if (!date) return reply.code(422).send(problem(422, "validation", "Choose the day"));
    const occupancyOk = new Set(["vacant", "occupied", "arrival", "departure", "stayover"]);
    const cleanOk = new Set(["full", "stayover", "linen", "none"]);
    for (const room of rooms.slice(0, 200)) {
      const number = clean(room?.number, 20);
      if (!number) continue;
      const found = (await pool.query(`select id from room where property_id=$1 and number=$2`, [a.propertyId, number])).rows[0];
      if (!found) continue;
      const occupancy = occupancyOk.has(room.occupancy) ? room.occupancy : "vacant";
      const cleanType = cleanOk.has(room.clean_type) ? room.clean_type : "full";
      const assignee = uuid(room.assignee_user_id);
      await pool.query(
        `insert into hk_assignment (tenant_id, property_id, room_id, on_date, assignee_user_id, occupancy, clean_type, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (room_id, on_date) do update set
           assignee_user_id=excluded.assignee_user_id, occupancy=excluded.occupancy, clean_type=excluded.clean_type,
           updated_by=excluded.updated_by, updated_at=now()`,
        [a.tenantId, a.propertyId, found.id, date, assignee, occupancy, cleanType, a.userId],
      );
    }
    return { ok: true };
  });

  f.get("/v1/housekeeping/reports", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const from = day(req.query?.from) ?? new Date().toISOString().slice(0, 10);
    const to = day(req.query?.to) ?? from;
    const byUser = (await pool.query(
      `select coalesce(u.display_name, 'Unassigned') name, count(*)::int rooms,
              count(*) filter (where a.clean_type <> 'none')::int to_clean
       from hk_assignment a
       left join app_user u on u.id=a.assignee_user_id
       where a.property_id=$1 and a.on_date between $2 and $3
       group by 1 order by 1`,
      [a.propertyId, from, to],
    )).rows;
    const byRoom = (await pool.query(
      `select r.number, a.on_date::text, a.occupancy, a.clean_type, coalesce(u.display_name, '') assignee
       from hk_assignment a
       join room r on r.id=a.room_id
       left join app_user u on u.id=a.assignee_user_id
       where a.property_id=$1 and a.on_date between $2 and $3
       order by a.on_date, r.number`,
      [a.propertyId, from, to],
    )).rows;
    const cleaned = (await pool.query(
      `select coalesce(u.display_name, 'House') name, count(*)::int cleans
       from room_status_event e
       join room r on r.id=e.room_id
       left join app_user u on u.id=e.by_user_id
       where r.property_id=$1 and e.to_status='CLEANING'
         and (e.at at time zone 'Europe/London')::date between $2::date and $3::date
       group by 1 order by 2 desc`,
      [a.propertyId, from, to],
    )).rows;
    return { from, to, by_user: byUser, by_room: byRoom, cleaned };
  });
}
