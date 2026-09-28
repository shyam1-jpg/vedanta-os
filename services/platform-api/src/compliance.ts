/** Compliance calendar. Reminders are idempotent: one note per lead, per due date. */
import type { FastifyInstance } from "fastify";
import { pool, tx } from "./db.ts";
import { requireActor, allow, problem } from "./auth.ts";
import { audit } from "./groups.ts";
import { sendEmail } from "./email.ts";
import { cleanAttachment } from "../../../domains/ops/fault.ts";
import {
  COMPLIANCE_CATEGORIES,
  categoryLabel,
  complianceNotices,
  itemStatus,
  parseComplianceItem,
  parseComplianceSettings,
  pendingAlerts,
  rollDue,
  scheduleLabel,
  type ComplianceNotice,
} from "../../../domains/ops/compliance.ts";
import { capaStatusOk } from "../../../domains/guest/feedback.ts";
import { sealText, openText } from "./fieldCrypto.ts";

async function actor(req: any, reply: any) {
  return requireActor(req, reply, ["ADMIN", "STAFF"]);
}

async function londonToday(): Promise<string> {
  const row = (await pool.query(`select (timezone('Europe/London', now()))::date::text d`)).rows[0];
  return row.d;
}

async function loadSettings(propertyId: string) {
  const row = (await pool.query(`select settings from property where id=$1`, [propertyId])).rows[0];
  return parseComplianceSettings(row?.settings?.compliance);
}

async function deliver(a: { tenantId: string; propertyId: string; userId?: string | null }, notes: ComplianceNotice[], itemId: string) {
  for (const note of notes) {
    await sendEmail(a, { to: note.to, subject: note.subject, body: note.body, kind: `compliance_${note.audience}`, related_type: "compliance_item", related_id: itemId });
  }
}

export async function sendDueCompliance(propertyId: string): Promise<number> {
  const settings = await loadSettings(propertyId);
  const today = await londonToday();
  const prop = (await pool.query(`select tenant_id from property where id=$1`, [propertyId])).rows[0];
  if (!prop) return 0;
  const items = (await pool.query(
    `select i.id, i.title, i.next_due::text due, u.email responsible_email
     from compliance_item i
     left join app_user u on u.id = i.responsible_user_id
     where i.property_id=$1 and i.active and i.next_due is not null`,
    [propertyId],
  )).rows;
  let sent = 0;
  for (const item of items) {
    const already = (await pool.query(
      `select kind from compliance_alert where item_id=$1 and due_on=$2`,
      [item.id, item.due],
    )).rows.map((row: { kind: string }) => row.kind);
    const kinds = pendingAlerts(item.due, today, settings.leads, already);
    for (const kind of kinds) {
      const claimed = (await pool.query(
        `insert into compliance_alert (item_id, kind, due_on) values ($1,$2,$3)
         on conflict do nothing returning item_id`,
        [item.id, kind, item.due],
      )).rows[0];
      if (!claimed) continue;
      const notes = complianceNotices(
        { title: item.title, due: item.due, kind },
        { responsible: String(item.responsible_email ?? ""), manager: settings.manager },
      );
      await deliver({ tenantId: prop.tenant_id, propertyId, userId: null }, notes, item.id);
      sent += 1;
    }
  }
  return sent;
}

function view(row: any, today: string, history: any[]) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    category_label: categoryLabel(row.category),
    repeating: row.repeating,
    every_n: row.every_n,
    every_unit: row.every_unit,
    schedule_label: scheduleLabel(row.repeating, row.every_n, row.every_unit),
    next_due: row.next_due,
    status: itemStatus(row.next_due, today),
    responsible_user_id: row.responsible_user_id,
    responsible_name: row.responsible_name,
    example: row.example,
    history: history.map(entry => ({
      id: entry.id,
      due_on: entry.due_on,
      notes: openText(entry.notes),
      has_attachment: !!entry.attachment,
      found_issues: entry.found_issues,
      capa_id: entry.capa_id,
      capa_status: entry.capa_status,
      by_name: entry.by_name,
      completed_at: entry.completed_at,
    })),
  };
}

export default async function complianceRoutes(f: FastifyInstance) {
  f.get("/v1/settings/compliance", async (req, reply) => {
    const a = await actor(req, reply); if (!a) return;
    if (!a.perms.has("package.manage") && !a.perms.has("compliance.calendar")) {
      return reply.code(403).send(problem(403, "forbidden", "You cannot open compliance settings"));
    }
    const settings = await loadSettings(a.propertyId);
    return {
      ...settings,
      receives: "The responsible person and the general manager, before each deadline and when it is overdue.",
    };
  });

  f.put("/v1/settings/compliance", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "package.manage", reply)) return;
    const settings = parseComplianceSettings(req.body ?? {});
    await pool.query(
      `update property set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{compliance}', $2::jsonb, true) where id=$1`,
      [a.propertyId, JSON.stringify(settings)],
    );
    return settings;
  });

  f.get("/v1/compliance/items", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "compliance.calendar", reply)) return;
    const today = await londonToday();
    const rows = (await pool.query(
      `select i.id, i.title, i.category, i.repeating, i.every_n, i.every_unit, i.next_due::text, i.responsible_user_id, i.example,
              u.display_name responsible_name
       from compliance_item i
       left join app_user u on u.id = i.responsible_user_id
       where i.property_id=$1 and i.active
       order by i.next_due nulls last, i.title`,
      [a.propertyId],
    )).rows;
    const ids = rows.map((row: { id: string }) => row.id);
    const history = ids.length
      ? (await pool.query(
        `select c.item_id, c.id, c.due_on::text, c.notes, (c.attachment is not null) as attachment, c.found_issues, c.capa_id, p.status capa_status, c.by_name, c.completed_at
         from compliance_completion c
         left join capa p on p.id = c.capa_id
         where c.item_id = any($1::uuid[])
         order by c.completed_at desc`,
        [ids],
      )).rows
      : [];
    const people = (await pool.query(
      `select distinct u.id, u.display_name name
       from app_user u join membership m on m.user_id=u.id
       where m.property_id=$1 and u.status='ACTIVE'
       order by u.display_name`,
      [a.propertyId],
    )).rows;
    const q = String(req.query?.q ?? "").trim().toLowerCase();
    const category = String(req.query?.category ?? "");
    const status = String(req.query?.status ?? "");
    let items = rows.map((row: any) => view(row, today, history.filter((entry: { item_id: string }) => entry.item_id === row.id).slice(0, 12)));
    if (category) items = items.filter((item: { category: string }) => item.category === category);
    if (status) items = items.filter((item: { status: string }) => item.status === status);
    if (q) items = items.filter((item: { title: string }) => item.title.toLowerCase().includes(q));
    return { today, categories: COMPLIANCE_CATEGORIES, people, items };
  });

  f.post("/v1/compliance/items", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "compliance.calendar", reply)) return;
    const parsed = parseComplianceItem(req.body);
    if (!parsed.ok) return reply.code(422).send(problem(422, "validation", parsed.error));
    const saved = await tx(async c => {
      const row = (await c.query(
        `insert into compliance_item (tenant_id, property_id, title, category, repeating, every_n, every_unit, next_due, responsible_user_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [a.tenantId, a.propertyId, parsed.title, parsed.category, parsed.repeating, parsed.every, parsed.unit, parsed.nextDue, parsed.responsibleUserId],
      )).rows[0];
      await audit(c, a, "compliance_item", row.id, "compliance.add", { payload: { title: parsed.title } });
      return row;
    });
    reply.code(201);
    return { id: saved.id };
  });

  f.patch("/v1/compliance/items/:id", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "compliance.calendar", reply)) return;
    const parsed = parseComplianceItem(req.body);
    if (!parsed.ok) return reply.code(422).send(problem(422, "validation", parsed.error));
    const saved = await tx(async c => {
      const row = (await c.query(`select id from compliance_item where id=$1 and property_id=$2 for update`, [req.params.id, a.propertyId])).rows[0];
      if (!row) { reply.code(404); return problem(404, "not_found", "That item is not on the calendar"); }
      await c.query(
        `update compliance_item set title=$2, category=$3, repeating=$4, every_n=$5, every_unit=$6, next_due=$7, responsible_user_id=$8, example=false, updated_at=now() where id=$1`,
        [row.id, parsed.title, parsed.category, parsed.repeating, parsed.every, parsed.unit, parsed.nextDue, parsed.responsibleUserId],
      );
      await audit(c, a, "compliance_item", row.id, "compliance.edit", { payload: { title: parsed.title } });
      return { ok: true };
    });
    return saved;
  });

  f.post("/v1/compliance/items/:id/complete", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "compliance.calendar", reply)) return;
    const file = cleanAttachment(req.body?.attachment ?? req.body?.photo);
    if (!file.ok) return reply.code(422).send(problem(422, "validation", file.error));
    const notes = String(req.body?.notes ?? "").trim().slice(0, 2000);
    const issues = req.body?.found_issues === true || req.body?.found_issues === "true";
    const today = await londonToday();
    const saved = await tx(async c => {
      const row = (await c.query(
        `select id, title, repeating, every_n, every_unit, next_due::text, responsible_user_id
         from compliance_item where id=$1 and property_id=$2 and active for update`,
        [req.params.id, a.propertyId],
      )).rows[0];
      if (!row) { reply.code(404); return problem(404, "not_found", "That item is not on the calendar"); }
      const due = row.next_due || null;
      const completion = (await c.query(
        `insert into compliance_completion (item_id, tenant_id, property_id, due_on, notes, attachment, found_issues, by_user_id, by_name)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [row.id, a.tenantId, a.propertyId, due, sealText(notes || null), file.file, issues, a.userId, a.name],
      )).rows[0];
      let capaId: string | null = null;
      if (issues) {
        const dueOn = (await c.query(`select (timezone('Europe/London', now()))::date + 7 d`)).rows[0].d;
        capaId = (await c.query(
          `insert into capa (tenant_id, property_id, status, due_on, source_type, source_id)
           values ($1,$2,'open',$3,'compliance',$4) returning id`,
          [a.tenantId, a.propertyId, dueOn, completion.id],
        )).rows[0].id;
        await c.query(
          `insert into capa_event (capa_id, tenant_id, property_id, to_status, note, by_user_id, by_name)
           values ($1,$2,$3,'open','Opened from a compliance completion',$4,$5)`,
          [capaId, a.tenantId, a.propertyId, a.userId, a.name],
        );
        await c.query(`update compliance_completion set capa_id=$2 where id=$1`, [completion.id, capaId]);
      }
      const next = rollDue(due ?? today, row.every_n, row.every_unit, today, row.repeating);
      await c.query(`update compliance_item set next_due=$2, example=false, updated_at=now() where id=$1`, [row.id, next]);
      await audit(c, a, "compliance_item", row.id, "compliance.complete", { payload: { issues, capa_id: capaId } });
      return { ok: true, next_due: next, capa_id: capaId, title: row.title as string, responsible_user_id: row.responsible_user_id as string | null };
    });
    if (!saved || !("ok" in saved)) return saved;
    if (saved.capa_id) {
      const settings = await loadSettings(a.propertyId);
      const who = saved.responsible_user_id
        ? (await pool.query(`select email from app_user where id=$1`, [saved.responsible_user_id])).rows[0]
        : null;
      const notesOut = complianceNotices(
        { title: saved.title, due: today, kind: "overdue" },
        { responsible: String(who?.email ?? ""), manager: settings.manager },
      ).map(note => ({
        ...note,
        subject: `Compliance · ${saved.title} needs a corrective action`,
        body: `${a.name} logged ${saved.title} and marked that something needs putting right.\n\nA corrective action is open on the compliance calendar.`,
      }));
      await deliver(a, notesOut, req.params.id);
    }
    return { ok: true, next_due: saved.next_due, capa_id: saved.capa_id };
  });

  f.patch("/v1/compliance/capa/:id", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "compliance.calendar", reply)) return;
    const status = req.body?.status;
    if (status != null && !capaStatusOk(status)) return reply.code(422).send(problem(422, "validation", "That status is not on the list"));
    const saved = await tx(async c => {
      const row = (await c.query(`select * from capa where id=$1 and property_id=$2 and source_type='compliance' for update`, [req.params.id, a.propertyId])).rows[0];
      if (!row) { reply.code(404); return problem(404, "not_found", "No such corrective action"); }
      const next = status ?? row.status;
      const root = req.body?.root_cause !== undefined ? sealText(String(req.body.root_cause ?? "").trim().slice(0, 2000) || null) : row.root_cause;
      const corrective = req.body?.corrective_action !== undefined ? sealText(String(req.body.corrective_action ?? "").trim().slice(0, 2000) || null) : row.corrective_action;
      const preventive = req.body?.preventive_action !== undefined ? sealText(String(req.body.preventive_action ?? "").trim().slice(0, 2000) || null) : row.preventive_action;
      await c.query(
        `update capa set status=$2, root_cause=$3, corrective_action=$4, preventive_action=$5, updated_at=now() where id=$1`,
        [row.id, next, root, corrective, preventive],
      );
      await c.query(
        `insert into capa_event (capa_id, tenant_id, property_id, from_status, to_status, note, by_user_id, by_name)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [row.id, a.tenantId, a.propertyId, row.status, next, next === row.status ? "Details updated" : null, a.userId, a.name],
      );
      await audit(c, a, "capa", row.id, "capa.update", { from: row.status, to: next });
      return { ok: true, status: next };
    });
    return saved;
  });
}
