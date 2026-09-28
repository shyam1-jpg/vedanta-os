/** Induction tracker. Staff can say they have done an item. A manager signs it off. */
import type { FastifyInstance } from "fastify";
import { pool, tx } from "./db.ts";
import { requireActor, allow, problem } from "./auth.ts";
import { audit } from "./groups.ts";
import { sendEmail } from "./email.ts";
import { openText, sealText } from "./fieldCrypto.ts";
import { cleanAttachment } from "../../../domains/ops/fault.ts";
import {
  TRAINING_CATEGORIES,
  addMonths,
  categoryLabel,
  cellTone,
  clearedForWork,
  parseTemplate,
  parseTrainingItem,
  parseTrainingSettings,
  pendingTrainingAlerts,
  staffProgress,
  trainingNotices,
  type TrainingNotice,
} from "../../../domains/staff/training.ts";

async function actor(req: any, reply: any) {
  return requireActor(req, reply, ["ADMIN", "STAFF"]);
}

function canManage(a: { perms: Set<string> }) {
  return a.perms.has("training.manage");
}
function canSign(a: { perms: Set<string> }) {
  return a.perms.has("training.signoff") || a.perms.has("training.manage");
}

async function londonToday(): Promise<string> {
  return (await pool.query(`select (timezone('Europe/London', now()))::date::text d`)).rows[0].d;
}

async function loadSettings(propertyId: string) {
  const row = (await pool.query(`select settings from property where id=$1`, [propertyId])).rows[0];
  return parseTrainingSettings(row?.settings?.training);
}

async function deliver(a: { tenantId: string; propertyId: string; userId?: string | null }, notes: TrainingNotice[], assignmentId: string) {
  for (const note of notes) {
    await sendEmail(a, { to: note.to, subject: note.subject, body: note.body, kind: `training_${note.audience}`, related_type: "training_assignment", related_id: assignmentId });
  }
}

type Row = { required: boolean; signedOff: boolean; expiresOn: string | null };

export async function clearanceForUsers(propertyId: string, userIds: string[]): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  if (!userIds.length) return map;
  const today = await londonToday();
  const rows = (await pool.query(
    `select a.user_id, i.required_before_unsupervised required, a.signed_off_at, a.expires_on::text
     from training_assignment a
     join training_item i on i.id = a.item_id
     where a.property_id=$1 and a.user_id = any($2::uuid[])`,
    [propertyId, userIds],
  )).rows;
  const grouped = new Map<string, Row[]>();
  for (const id of userIds) grouped.set(id, []);
  for (const row of rows) {
    grouped.get(row.user_id)?.push({ required: row.required, signedOff: !!row.signed_off_at, expiresOn: row.expires_on });
  }
  for (const [id, list] of grouped) map.set(id, clearedForWork(list, today));
  return map;
}

export async function sendDueTraining(propertyId: string): Promise<number> {
  const settings = await loadSettings(propertyId);
  const today = await londonToday();
  const prop = (await pool.query(`select tenant_id from property where id=$1`, [propertyId])).rows[0];
  if (!prop) return 0;
  const rows = (await pool.query(
    `select a.id, a.expires_on::text, i.title, u.display_name person, u.email
     from training_assignment a
     join training_item i on i.id = a.item_id
     join app_user u on u.id = a.user_id
     where a.property_id=$1 and a.signed_off_at is not null and a.expires_on is not null`,
    [propertyId],
  )).rows;
  let sent = 0;
  for (const row of rows) {
    const already = (await pool.query(`select kind from training_alert where assignment_id=$1 and expires_on=$2`, [row.id, row.expires_on])).rows.map((r: { kind: string }) => r.kind);
    for (const kind of pendingTrainingAlerts(row.expires_on, today, settings.leads, already)) {
      const claimed = (await pool.query(
        `insert into training_alert (assignment_id, kind, expires_on) values ($1,$2,$3) on conflict do nothing returning assignment_id`,
        [row.id, kind, row.expires_on],
      )).rows[0];
      if (!claimed) continue;
      await deliver(
        { tenantId: prop.tenant_id, propertyId, userId: null },
        trainingNotices({ title: row.title, person: row.person, expiresOn: row.expires_on, kind }, { staff: String(row.email ?? ""), manager: settings.manager }),
        row.id,
      );
      sent += 1;
    }
  }
  return sent;
}

export default async function trainingRoutes(f: FastifyInstance) {
  f.get("/v1/settings/training", async (req, reply) => {
    const a = await actor(req, reply); if (!a) return;
    if (!a.perms.has("package.manage") && !canManage(a)) return reply.code(403).send(problem(403, "forbidden", "You cannot open training settings"));
    return await loadSettings(a.propertyId);
  });

  f.put("/v1/settings/training", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "package.manage", reply)) return;
    const settings = parseTrainingSettings(req.body ?? {});
    await pool.query(
      `update property set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{training}', $2::jsonb, true) where id=$1`,
      [a.propertyId, JSON.stringify(settings)],
    );
    return settings;
  });

  f.get("/v1/induction/mine", async (req, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "training.self", reply)) return;
    const today = await londonToday();
    const rows = (await pool.query(
      `select a.id, a.status, a.done_at, a.signed_off_at, a.signed_off_name, a.notes, a.issued_on::text, a.expires_on::text,
              (a.certificate is not null) has_certificate,
              i.title, i.category, i.required_before_unsupervised required, i.certificate is_certificate, i.link, s.title sop_title,
              (select json_agg(json_build_object('to_status', e.to_status, 'note', e.note, 'by_name', e.by_name, 'created_at', e.created_at) order by e.created_at)
               from training_event e where e.assignment_id = a.id) events
       from training_assignment a
       join training_item i on i.id = a.item_id
       left join staff_sop s on s.id = i.sop_id
       where a.user_id=$1 and a.property_id=$2
       order by i.required_before_unsupervised desc, i.title`,
      [a.userId, a.propertyId],
    )).rows;
    const cleared = clearedForWork(rows.map((row: any) => ({ required: row.required, signedOff: !!row.signed_off_at, expiresOn: row.expires_on })), today);
    return {
      cleared,
      items: rows.map((row: any) => ({
        ...row,
        notes: openText(row.notes),
        category_label: categoryLabel(row.category),
        tone: cellTone(true, row.status, !!row.signed_off_at, row.expires_on, today),
        events: row.events ?? [],
      })),
    };
  });

  f.post("/v1/induction/assignments/:id/done", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "training.self", reply)) return;
    const saved = await tx(async c => {
      const row = (await c.query(`select * from training_assignment where id=$1 and property_id=$2 and user_id=$3 for update`, [req.params.id, a.propertyId, a.userId])).rows[0];
      if (!row) { reply.code(404); return problem(404, "not_found", "That item is not on your list"); }
      const next = staffProgress(row.status);
      if (!next) { reply.code(422); return problem(422, "validation", "A manager has already signed this off"); }
      const notes = req.body?.notes != null ? sealText(String(req.body.notes).trim().slice(0, 1000) || null) : row.notes;
      await c.query(`update training_assignment set status=$2, done_at=coalesce(done_at, now()), notes=$3 where id=$1`, [row.id, next, notes]);
      await c.query(
        `insert into training_event (assignment_id, tenant_id, property_id, from_status, to_status, note, by_user_id, by_name)
         values ($1,$2,$3,$4,$5,'Marked as done',$6,$7)`,
        [row.id, a.tenantId, a.propertyId, row.status, next, a.userId, a.name],
      );
      await audit(c, a, "training_assignment", row.id, "training.done", { from: row.status, to: next });
      return { ok: true, status: next };
    });
    return saved;
  });

  f.get("/v1/induction/clearance", async (req, reply) => {
    const a = await actor(req, reply); if (!a) return;
    if (!a.perms.has("training.signoff") && !a.perms.has("user.manage") && !a.perms.has("training.manage")) {
      return reply.code(403).send(problem(403, "forbidden", "You cannot see who is cleared"));
    }
    const people = (await pool.query(
      `select distinct u.id from app_user u join membership m on m.user_id=u.id where m.property_id=$1 and u.status='ACTIVE'`,
      [a.propertyId],
    )).rows.map((row: { id: string }) => row.id);
    const map = await clearanceForUsers(a.propertyId, people);
    return { people: people.map(id => ({ id, cleared: map.get(id) ?? false })) };
  });

  f.get("/v1/induction/matrix", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "training.signoff", reply)) return;
    const today = await londonToday();
    const items = (await pool.query(
      `select i.id, i.title, i.category, i.required_before_unsupervised required, i.certificate, i.valid_months, i.example, i.link, i.description, s.title sop_title, (i.attachment is not null) has_attachment
       from training_item i left join staff_sop s on s.id = i.sop_id
       where i.property_id=$1 and i.active order by i.title`,
      [a.propertyId],
    )).rows;
    const people = (await pool.query(
      `select distinct u.id, u.display_name name, ro.code role, ro.name role_name, d.code department, d.name department_name
       from app_user u
       join membership m on m.user_id = u.id
       join role ro on ro.id = m.role_id
       left join department d on d.id = m.department_id
       where m.property_id=$1 and u.status='ACTIVE'
       order by u.display_name`,
      [a.propertyId],
    )).rows;
    const assignments = (await pool.query(
      `select a.id, a.user_id, a.item_id, a.status, a.signed_off_at, a.signed_off_name, a.expires_on::text, a.issued_on::text, a.done_at
       from training_assignment a where a.property_id=$1`,
      [a.propertyId],
    )).rows;
    const byUser = new Map<string, any[]>();
    for (const row of assignments) {
      const list = byUser.get(row.user_id) ?? [];
      list.push(row);
      byUser.set(row.user_id, list);
    }
    const category = String(req.query?.category ?? "");
    const role = String(req.query?.role ?? "");
    const department = String(req.query?.department ?? "");
    const q = String(req.query?.q ?? "").trim().toLowerCase();
    let shownItems = items;
    if (category) shownItems = shownItems.filter((item: { category: string }) => item.category === category);
    let shownPeople = people;
    if (role) shownPeople = shownPeople.filter((person: { role: string }) => person.role === role);
    if (department) shownPeople = shownPeople.filter((person: { department: string }) => person.department === department);
    if (q) shownPeople = shownPeople.filter((person: { name: string }) => person.name.toLowerCase().includes(q));
    const matrix = shownPeople.map((person: any) => {
      const mine = byUser.get(person.id) ?? [];
      const cells = shownItems.map((item: { id: string }) => {
        const hit = mine.find((row: { item_id: string }) => row.item_id === item.id);
        return {
          item_id: item.id,
          assignment_id: hit?.id ?? null,
          status: hit?.status ?? null,
          signed_off_name: hit?.signed_off_name ?? null,
          expires_on: hit?.expires_on ?? null,
          tone: cellTone(!!hit, hit?.status ?? "not_started", !!hit?.signed_off_at, hit?.expires_on ?? null, today),
        };
      });
      const cleared = clearedForWork(mine.map((row: any) => {
        const item = items.find((entry: { id: string }) => entry.id === row.item_id);
        return { required: !!item?.required, signedOff: !!row.signed_off_at, expiresOn: row.expires_on };
      }), today);
      return { ...person, cleared, cells };
    });
    const filtered = req.query?.cleared === "yes" ? matrix.filter((p: { cleared: boolean }) => p.cleared) : req.query?.cleared === "no" ? matrix.filter((p: { cleared: boolean }) => !p.cleared) : matrix;
    const sops = (await pool.query(`select id, title from staff_sop where property_id=$1 order by title`, [a.propertyId])).rows;
    const templates = (await pool.query(
      `select t.id, t.name, t.role_code, t.department, t.example,
              coalesce(json_agg(json_build_object('id', i.id, 'title', i.title)) filter (where i.id is not null), '[]') items
       from training_template t
       left join training_template_item ti on ti.template_id = t.id
       left join training_item i on i.id = ti.item_id
       where t.property_id=$1 and t.active
       group by t.id order by t.name`,
      [a.propertyId],
    )).rows;
    const roles = (await pool.query(`select code, name from role where tenant_id=$1 order by name`, [a.tenantId])).rows;
    const departments = (await pool.query(`select code, name from department where property_id=$1 order by name`, [a.propertyId])).rows;
    return { today, categories: TRAINING_CATEGORIES, items: shownItems.map((item: any) => ({ ...item, category_label: categoryLabel(item.category) })), people: filtered, sops, templates, roles, departments };
  });

  f.post("/v1/induction/library", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "training.manage", reply)) return;
    const parsed = parseTrainingItem(req.body);
    if (!parsed.ok) return reply.code(422).send(problem(422, "validation", parsed.error));
    const file = cleanAttachment(req.body?.attachment);
    if (!file.ok) return reply.code(422).send(problem(422, "validation", file.error));
    const saved = await tx(async c => {
      const row = (await c.query(
        `insert into training_item (tenant_id, property_id, title, description, category, required_before_unsupervised, certificate, valid_months, sop_id, link, attachment)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
        [a.tenantId, a.propertyId, parsed.title, parsed.description || null, parsed.category, parsed.required, parsed.certificate, parsed.validMonths, parsed.sopId, parsed.link || null, file.file],
      )).rows[0];
      await audit(c, a, "training_item", row.id, "training.add", { payload: { title: parsed.title } });
      return row;
    });
    reply.code(201);
    return { id: saved.id };
  });

  f.patch("/v1/induction/library/:id", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "training.manage", reply)) return;
    const parsed = parseTrainingItem(req.body);
    if (!parsed.ok) return reply.code(422).send(problem(422, "validation", parsed.error));
    const file = req.body?.attachment !== undefined ? cleanAttachment(req.body.attachment) : { ok: true as const, file: undefined };
    if (!file.ok) return reply.code(422).send(problem(422, "validation", file.error));
    const saved = await tx(async c => {
      const row = (await c.query(`select id, attachment from training_item where id=$1 and property_id=$2 for update`, [req.params.id, a.propertyId])).rows[0];
      if (!row) { reply.code(404); return problem(404, "not_found", "That training is not in the library"); }
      await c.query(
        `update training_item set title=$2, description=$3, category=$4, required_before_unsupervised=$5, certificate=$6, valid_months=$7, sop_id=$8, link=$9, attachment=$10, example=false, updated_at=now() where id=$1`,
        [row.id, parsed.title, parsed.description || null, parsed.category, parsed.required, parsed.certificate, parsed.validMonths, parsed.sopId, parsed.link || null, file.file === undefined ? row.attachment : file.file],
      );
      await audit(c, a, "training_item", row.id, "training.edit", { payload: { title: parsed.title } });
      return { ok: true };
    });
    return saved;
  });

  f.post("/v1/induction/templates", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "training.manage", reply)) return;
    const parsed = parseTemplate(req.body);
    if (!parsed.ok) return reply.code(422).send(problem(422, "validation", parsed.error));
    const saved = await tx(async c => {
      const row = (await c.query(
        `insert into training_template (tenant_id, property_id, name, role_code, department) values ($1,$2,$3,$4,$5) returning id`,
        [a.tenantId, a.propertyId, parsed.name, parsed.role || null, parsed.department || null],
      )).rows[0];
      const ids = Array.isArray(req.body?.item_ids) ? req.body.item_ids : [];
      for (const itemId of ids) {
        if (!/^[0-9a-f-]{36}$/i.test(String(itemId))) continue;
        await c.query(`insert into training_template_item (template_id, item_id) select $1, id from training_item where id=$2 and property_id=$3 on conflict do nothing`, [row.id, itemId, a.propertyId]);
      }
      await audit(c, a, "training_template", row.id, "training.template", { payload: { name: parsed.name } });
      return row;
    });
    reply.code(201);
    return { id: saved.id };
  });

  f.post("/v1/induction/templates/:id/items", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "training.manage", reply)) return;
    const itemId = String(req.body?.item_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(itemId)) return reply.code(422).send(problem(422, "validation", "Choose an item from the library"));
    await pool.query(
      `insert into training_template_item (template_id, item_id)
       select t.id, i.id from training_template t join training_item i on i.property_id=t.property_id
       where t.id=$1 and t.property_id=$2 and i.id=$3
       on conflict do nothing`,
      [req.params.id, a.propertyId, itemId],
    );
    return { ok: true };
  });

  f.delete("/v1/induction/templates/:id/items/:itemId", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "training.manage", reply)) return;
    await pool.query(
      `delete from training_template_item ti using training_template t
       where ti.template_id=t.id and t.property_id=$1 and ti.template_id=$2 and ti.item_id=$3`,
      [a.propertyId, req.params.id, req.params.itemId],
    );
    return { ok: true };
  });

  f.post("/v1/induction/assign", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "training.signoff", reply)) return;
    const userId = String(req.body?.user_id ?? "");
    const templateId = String(req.body?.template_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(userId) || !/^[0-9a-f-]{36}$/i.test(templateId)) {
      return reply.code(422).send(problem(422, "validation", "Choose a person and an induction"));
    }
    const saved = await tx(async c => {
      const items = (await c.query(
        `select i.id from training_template_item ti
         join training_template t on t.id = ti.template_id
         join training_item i on i.id = ti.item_id
         where ti.template_id=$1 and t.property_id=$2`,
        [templateId, a.propertyId],
      )).rows;
      if (!items.length) { reply.code(404); return problem(404, "not_found", "That induction has no items"); }
      let added = 0;
      for (const item of items) {
        const row = (await c.query(
          `insert into training_assignment (tenant_id, property_id, user_id, item_id)
           values ($1,$2,$3,$4) on conflict (property_id, user_id, item_id) do nothing returning id`,
          [a.tenantId, a.propertyId, userId, item.id],
        )).rows[0];
        if (!row) continue;
        added += 1;
        await c.query(
          `insert into training_event (assignment_id, tenant_id, property_id, to_status, note, by_user_id, by_name)
           values ($1,$2,$3,'not_started','Added from an induction',$4,$5)`,
          [row.id, a.tenantId, a.propertyId, a.userId, a.name],
        );
      }
      await audit(c, a, "training_template", templateId, "training.assign", { payload: { user_id: userId, added } });
      return { ok: true, added };
    });
    return saved;
  });

  f.post("/v1/induction/assignments", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "training.signoff", reply)) return;
    const userId = String(req.body?.user_id ?? "");
    const itemId = String(req.body?.item_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(userId) || !/^[0-9a-f-]{36}$/i.test(itemId)) {
      return reply.code(422).send(problem(422, "validation", "Choose a person and an item"));
    }
    const saved = await tx(async c => {
      const row = (await c.query(
        `insert into training_assignment (tenant_id, property_id, user_id, item_id)
         select $1,$2,$3,i.id from training_item i where i.id=$4 and i.property_id=$2
         on conflict (property_id, user_id, item_id) do nothing returning id`,
        [a.tenantId, a.propertyId, userId, itemId],
      )).rows[0];
      if (!row) { reply.code(409); return problem(409, "conflict", "That item is already on their list"); }
      await c.query(
        `insert into training_event (assignment_id, tenant_id, property_id, to_status, note, by_user_id, by_name)
         values ($1,$2,$3,'not_started','Added to the checklist',$4,$5)`,
        [row.id, a.tenantId, a.propertyId, a.userId, a.name],
      );
      return row;
    });
    if (!saved || !("id" in saved)) return saved;
    reply.code(201);
    return { id: saved.id };
  });

  f.delete("/v1/induction/assignments/:id", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "training.signoff", reply)) return;
    const row = (await pool.query(`delete from training_assignment where id=$1 and property_id=$2 returning id`, [req.params.id, a.propertyId])).rows[0];
    if (!row) return reply.code(404).send(problem(404, "not_found", "That item is not on the checklist"));
    return { ok: true };
  });

  f.post("/v1/induction/assignments/:id/signoff", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a) return;
    if (!canSign(a)) return reply.code(403).send(problem(403, "forbidden", "A manager signs this off"));
    const file = cleanAttachment(req.body?.certificate ?? req.body?.attachment);
    if (!file.ok) return reply.code(422).send(problem(422, "validation", file.error));
    const issued = String(req.body?.issued_on ?? "").slice(0, 10);
    let expires = String(req.body?.expires_on ?? "").slice(0, 10);
    if (issued && !/^\d{4}-\d{2}-\d{2}$/.test(issued)) return reply.code(422).send(problem(422, "validation", "That issue date is not valid"));
    if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) return reply.code(422).send(problem(422, "validation", "That expiry date is not valid"));
    const saved = await tx(async c => {
      const row = (await c.query(
        `select a.*, i.certificate, i.valid_months from training_assignment a
         join training_item i on i.id = a.item_id
         where a.id=$1 and a.property_id=$2 for update`,
        [req.params.id, a.propertyId],
      )).rows[0];
      if (!row) { reply.code(404); return problem(404, "not_found", "That item is not on the checklist"); }
      if (row.certificate && issued && !expires && row.valid_months) expires = addMonths(issued, row.valid_months);
      const notes = req.body?.notes != null ? sealText(String(req.body.notes).trim().slice(0, 1000) || null) : row.notes;
      await c.query(
        `update training_assignment set status='completed', signed_off_at=now(), signed_off_by=$2, signed_off_name=$3, notes=$4, certificate=coalesce($5, certificate), issued_on=$6, expires_on=$7 where id=$1`,
        [row.id, a.userId, a.name, notes, file.file, issued || null, expires || null],
      );
      await c.query(
        `insert into training_event (assignment_id, tenant_id, property_id, from_status, to_status, note, by_user_id, by_name)
         values ($1,$2,$3,$4,'completed','Signed off',$5,$6)`,
        [row.id, a.tenantId, a.propertyId, row.status, a.userId, a.name],
      );
      await audit(c, a, "training_assignment", row.id, "training.signoff", { from: row.status, to: "completed" });
      return { ok: true };
    });
    return saved;
  });
}
