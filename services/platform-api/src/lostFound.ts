/** Lost and found. Contact details are sealed and removed when a case closes. */
import type { FastifyInstance } from "fastify";
import { pool, tx } from "./db.ts";
import { requireActor, allow, problem } from "./auth.ts";
import { audit } from "./groups.ts";
import { sendEmail } from "./email.ts";
import { openText, sealText } from "./fieldCrypto.ts";
import { cleanPhoto, parseAreas } from "../../../domains/ops/fault.ts";
import {
  LOST_CATEGORIES,
  closedStatus,
  heldTooLong,
  parseFoundItem,
  parseLostSettings,
  parseMissingReport,
  parseStatusChange,
  retentionNotice,
  suggestMatches,
} from "../../../domains/ops/lostFound.ts";

async function actor(req: any, reply: any) {
  return requireActor(req, reply, ["ADMIN", "STAFF"]);
}

async function londonToday(): Promise<string> {
  return (await pool.query(`select (timezone('Europe/London', now()))::date::text d`)).rows[0].d;
}

async function loadSettings(propertyId: string) {
  const row = (await pool.query(`select settings from property where id=$1`, [propertyId])).rows[0];
  return parseLostSettings(row?.settings?.lost_found);
}

export async function remindLostFound(propertyId: string): Promise<number> {
  const settings = await loadSettings(propertyId);
  if (!settings.manager) return 0;
  const today = await londonToday();
  const prop = (await pool.query(`select tenant_id from property where id=$1`, [propertyId])).rows[0];
  if (!prop) return 0;
  const rows = (await pool.query(
    `select id, found_on::text, status from lost_item
     where property_id=$1 and retention_alerted_at is null and status in ('logged','matched','claimed')`,
    [propertyId],
  )).rows.filter((row: { found_on: string; status: string }) => heldTooLong(row.found_on, today, settings.hold_days, row.status));
  if (!rows.length) return 0;
  const ids = rows.map((row: { id: string }) => row.id);
  await pool.query(`update lost_item set retention_alerted_at=now() where id = any($1::uuid[]) and retention_alerted_at is null`, [ids]);
  const note = retentionNotice(ids.length, settings.hold_days);
  await sendEmail(
    { tenantId: prop.tenant_id, propertyId, userId: null },
    { to: settings.manager, subject: note.subject, body: note.body, kind: "lost_found_retention", related_type: "lost_item", related_id: ids[0] },
  );
  return ids.length;
}

function openItem(row: any) {
  return {
    ...row,
    claimant_name: openText(row.claimant_name),
    held_long: false,
  };
}

export default async function lostFoundRoutes(f: FastifyInstance) {
  f.get("/v1/settings/lost-found", async (req, reply) => {
    const a = await actor(req, reply); if (!a) return;
    if (!a.perms.has("package.manage") && !a.perms.has("lostfound.log")) {
      return reply.code(403).send(problem(403, "forbidden", "You cannot open lost and found settings"));
    }
    return await loadSettings(a.propertyId);
  });

  f.put("/v1/settings/lost-found", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "package.manage", reply)) return;
    const settings = parseLostSettings(req.body ?? {});
    await pool.query(
      `update property set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{lost_found}', $2::jsonb, true) where id=$1`,
      [a.propertyId, JSON.stringify(settings)],
    );
    return settings;
  });

  f.get("/v1/lost-found", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "lostfound.log", reply)) return;
    const today = await londonToday();
    const settings = await loadSettings(a.propertyId);
    const rooms = (await pool.query(`select number from room where property_id=$1 order by number`, [a.propertyId])).rows.map((row: { number: string }) => row.number);
    const areas = parseAreas((await pool.query(`select settings from property where id=$1`, [a.propertyId])).rows[0]?.settings?.fault_areas);
    const items = (await pool.query(
      `select i.*, i.found_on::text,
              (select json_agg(json_build_object('from_status', e.from_status, 'to_status', e.to_status, 'note', e.note, 'by_name', e.by_name, 'created_at', e.created_at) order by e.created_at)
               from lost_event e where e.item_id = i.id) events
       from lost_item i where i.property_id=$1 order by i.found_on desc limit 200`,
      [a.propertyId],
    )).rows.map((row: any) => ({
      ...openItem(row),
      has_photo: !!row.photo,
      photo: undefined,
      held_long: heldTooLong(row.found_on, today, settings.hold_days, row.status),
      events: row.events ?? [],
    }));
    const reports = (await pool.query(
      `select id, description, category, place, happened_on::text, guest_account_id, group_id, contact_name, contact_email, contact_phone, status, matched_item_id, created_at
       from lost_report where property_id=$1 order by created_at desc limit 100`,
      [a.propertyId],
    )).rows.map((row: any) => {
      const open = {
        ...row,
        description: openText(row.description),
        contact_name: openText(row.contact_name),
        contact_email: openText(row.contact_email),
        contact_phone: openText(row.contact_phone),
      };
      return { ...open, suggestions: row.status === "open" ? suggestMatches(open, items).map(item => ({ id: item.id, description: item.description, place: item.place, found_on: item.found_on })) : [] };
    });
    const q = String(req.query?.q ?? "").trim().toLowerCase();
    const category = String(req.query?.category ?? "");
    const status = String(req.query?.status ?? "");
    const place = String(req.query?.place ?? "");
    let filtered = items;
    if (category) filtered = filtered.filter((item: { category: string }) => item.category === category);
    if (status) filtered = filtered.filter((item: { status: string }) => item.status === status);
    if (place) filtered = filtered.filter((item: { place: string }) => item.place === place);
    if (q) filtered = filtered.filter((item: { description: string; storage: string | null }) => `${item.description} ${item.storage ?? ""}`.toLowerCase().includes(q));
    return { items: filtered, reports, rooms, areas, categories: LOST_CATEGORIES, hold_days: settings.hold_days };
  });

  f.post("/v1/lost-found", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "lostfound.log", reply)) return;
    const parsed = parseFoundItem(req.body);
    if (!parsed.ok) return reply.code(422).send(problem(422, "validation", parsed.error));
    const photo = cleanPhoto(req.body?.photo);
    if (!photo.ok) return reply.code(422).send(problem(422, "validation", photo.error));
    const saved = await tx(async c => {
      const row = (await c.query(
        `insert into lost_item (tenant_id, property_id, description, category, place, found_on, found_by_user_id, found_by_name, photo, storage)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [a.tenantId, a.propertyId, parsed.description, parsed.category, parsed.place, parsed.foundOn, a.userId, a.name, photo.photo, parsed.storage || null],
      )).rows[0];
      await c.query(
        `insert into lost_event (item_id, tenant_id, property_id, to_status, note, by_user_id, by_name)
         values ($1,$2,$3,'logged','Logged as found',$4,$5)`,
        [row.id, a.tenantId, a.propertyId, a.userId, a.name],
      );
      await audit(c, a, "lost_item", row.id, "lostfound.add", { payload: { place: parsed.place } });
      return row;
    });
    reply.code(201);
    return { id: saved.id };
  });

  f.post("/v1/lost-found/reports", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "lostfound.log", reply)) return;
    const parsed = parseMissingReport(req.body);
    if (!parsed.ok) return reply.code(422).send(problem(422, "validation", parsed.error));
    const guest = String(req.body?.guest_account_id ?? "").trim();
    const group = String(req.body?.group_id ?? "").trim();
    if (guest && !/^[0-9a-f-]{36}$/i.test(guest)) return reply.code(422).send(problem(422, "validation", "That guest is not on the list"));
    if (group && !/^[0-9a-f-]{36}$/i.test(group)) return reply.code(422).send(problem(422, "validation", "That booking is not on the list"));
    const saved = await tx(async c => {
      const row = (await c.query(
        `insert into lost_report (tenant_id, property_id, description, category, place, happened_on, guest_account_id, group_id, contact_name, contact_email, contact_phone, created_by_user_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
        [a.tenantId, a.propertyId, sealText(parsed.description), parsed.category, parsed.place || null, parsed.happenedOn || null, guest || null, group || null,
          sealText(parsed.contactName || null), sealText(parsed.contactEmail || null), sealText(parsed.contactPhone || null), a.userId],
      )).rows[0];
      await audit(c, a, "lost_report", row.id, "lostfound.report", {});
      return row;
    });
    reply.code(201);
    return { id: saved.id };
  });

  f.post("/v1/lost-found/:id/status", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "lostfound.log", reply)) return;
    const saved = await tx(async c => {
      const row = (await c.query(`select * from lost_item where id=$1 and property_id=$2 for update`, [req.params.id, a.propertyId])).rows[0];
      if (!row) { reply.code(404); return problem(404, "not_found", "That item is not in the log"); }
      const parsed = parseStatusChange(req.body, row.status);
      if (!parsed.ok) { reply.code(422); return problem(422, "validation", parsed.error); }
      const closed = closedStatus(parsed.status);
      await c.query(
        `update lost_item set status=$2, claimant_name=$3, claimed_at=case when $2 in ('claimed','returned') then coalesce(claimed_at, now()) else claimed_at end,
           return_method=$4, handled_by_user_id=$5, handled_by_name=$6, closed_at=case when $7 then now() else closed_at end,
           photo=case when $2 in ('disposed','donated') then null else photo end
         where id=$1`,
        [row.id, parsed.status, parsed.claimant ? sealText(parsed.claimant) : row.claimant_name, parsed.method, a.userId, a.name, closed],
      );
      await c.query(
        `insert into lost_event (item_id, tenant_id, property_id, from_status, to_status, note, by_user_id, by_name)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [row.id, a.tenantId, a.propertyId, row.status, parsed.status, parsed.note || null, a.userId, a.name],
      );
      if (closed) {
        await c.query(
          `update lost_report set status='closed', contact_name=null, contact_email=null, contact_phone=null
           where matched_item_id=$1 and property_id=$2`,
          [row.id, a.propertyId],
        );
      }
      const reportId = String(req.body?.report_id ?? "");
      if (parsed.status === "matched" && /^[0-9a-f-]{36}$/i.test(reportId)) {
        await c.query(
          `update lost_report set status='matched', matched_item_id=$2 where id=$1 and property_id=$3`,
          [reportId, row.id, a.propertyId],
        );
      }
      await audit(c, a, "lost_item", row.id, "lostfound.status", { from: row.status, to: parsed.status });
      return { ok: true, status: parsed.status };
    });
    return saved;
  });
}
