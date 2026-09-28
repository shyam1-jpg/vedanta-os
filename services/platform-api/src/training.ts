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
  canEditDepartment,
  canEditModule,
  detachModule,
  inductionItemIds,
  moduleVisible,
  nextShare,
  parseTemplate,
  parseTrainingItem,
  parseTrainingSettings,
  pendingTrainingAlerts,
  planChecklistEdit,
  staffProgress,
  trainingNotices,
  trainingScope,
  type ModuleShare,
  type Scope,
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

function deptCode(value: unknown): string {
  const code = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9_]{2,20}$/.test(code) ? code : "";
}

async function viewerScope(a: { userId: string; propertyId: string; role: string }): Promise<Scope> {
  const departments = (await pool.query(
    `select distinct d.code from membership m
     join department d on d.id = m.department_id
     where m.user_id=$1 and m.property_id=$2`,
    [a.userId, a.propertyId],
  )).rows.map((row: { code: string }) => String(row.code));
  return trainingScope({ role: a.role, departments });
}

async function propertyDepartments(propertyId: string): Promise<string[]> {
  return (await pool.query(`select code from department where property_id=$1 order by name`, [propertyId])).rows.map((row: { code: string }) => row.code);
}

async function moduleRow(propertyId: string, id: string) {
  return (await pool.query(
    `select i.*, coalesce(array_agg(md.department) filter (where md.department is not null), '{}') departments
     from training_item i
     left join training_module_dept md on md.item_id = i.id
     where i.id=$1 and i.property_id=$2
     group by i.id`,
    [id, propertyId],
  )).rows[0] as { id: string; title: string; share: ModuleShare; locked: boolean; departments: string[]; active: boolean } | undefined;
}

async function applyChecklist(
  c: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> },
  a: { tenantId: string; propertyId: string; userId: string; name: string },
  itemId: string,
  plan: { changed: boolean; clearSignoff: boolean; removeIds: string[]; upserts: { id: string | null; label: string; sort: number }[] },
) {
  if (!plan.changed) return;
  for (const id of plan.removeIds) await c.query(`delete from training_check where id=$1 and item_id=$2`, [id, itemId]);
  for (const step of plan.upserts) {
    if (step.id) await c.query(`update training_check set label=$2, sort_order=$3 where id=$1 and item_id=$4`, [step.id, step.label, step.sort, itemId]);
    else await c.query(`insert into training_check (item_id, label, sort_order) values ($1,$2,$3)`, [itemId, step.label, step.sort]);
  }
  await c.query(`update training_item set checklist_version = checklist_version + 1, updated_at=now() where id=$1`, [itemId]);
  if (!plan.clearSignoff) return;
  const cleared = (await c.query(
    `update training_assignment
     set status = case when exists (select 1 from training_tick t where t.assignment_id = training_assignment.id) or done_at is not null then 'in_progress' else 'not_started' end,
         signed_off_at = null, signed_off_by = null, signed_off_name = null, signed_off_version = null, issued_on = null, expires_on = null
     where item_id=$1 and property_id=$2 and signed_off_at is not null
     returning id, status`,
    [itemId, a.propertyId],
  )).rows;
  for (const row of cleared) {
    await c.query(
      `insert into training_event (assignment_id, tenant_id, property_id, from_status, to_status, note, by_user_id, by_name)
       values ($1,$2,$3,'completed',$4,'Checklist changed and needs training again',$5,$6)`,
      [row.id, a.tenantId, a.propertyId, row.status, a.userId, a.name],
    );
  }
}

async function replaceDepartments(
  c: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> },
  itemId: string,
  propertyId: string,
  share: ModuleShare,
) {
  if (share !== "all") return;
  await c.query(
    `insert into training_module_dept (item_id, department, sort_order)
     select $1, d.code, 0 from department d where d.property_id=$2
     on conflict (item_id, department) do nothing`,
    [itemId, propertyId],
  );
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
    const scope = await viewerScope(a);
    const rows = (await pool.query(
      `select a.id, a.item_id, a.status, a.done_at, a.signed_off_at, a.signed_off_name, a.notes, a.issued_on::text, a.expires_on::text,
              (a.certificate is not null) has_certificate,
              i.title, i.category, i.share, i.required_before_unsupervised required, i.certificate is_certificate, i.link, s.title sop_title,
              coalesce((select array_agg(md.department) from training_module_dept md where md.item_id = i.id), '{}') departments,
              (select json_agg(json_build_object('to_status', e.to_status, 'note', e.note, 'by_name', e.by_name, 'created_at', e.created_at) order by e.created_at)
               from training_event e where e.assignment_id = a.id) events
       from training_assignment a
       join training_item i on i.id = a.item_id
       left join staff_sop s on s.id = i.sop_id
       where a.user_id=$1 and a.property_id=$2 and i.active
       order by i.required_before_unsupervised desc, i.title`,
      [a.userId, a.propertyId],
    )).rows;
    const cleared = clearedForWork(rows.map((row: any) => ({ required: row.required, signedOff: !!row.signed_off_at, expiresOn: row.expires_on })), today);
    const visible = rows.filter((row: any) => moduleVisible({ share: row.share, departments: row.departments ?? [] }, scope));
    const checks = visible.length
      ? (await pool.query(
        `select c.id, c.item_id, c.label, c.sort_order, t.assignment_id
         from training_check c
         left join training_tick t on t.check_id = c.id and t.assignment_id = any($1::uuid[])
         where c.item_id = any($2::uuid[])
         order by c.sort_order, c.label`,
        [visible.map((row: { id: string }) => row.id), visible.map((row: { item_id: string }) => row.item_id)],
      )).rows
      : [];
    return {
      cleared,
      items: visible.map((row: any) => ({
        ...row,
        departments: row.departments ?? [],
        notes: openText(row.notes),
        category_label: categoryLabel(row.category),
        tone: cellTone(true, row.status, !!row.signed_off_at, row.expires_on, today),
        events: row.events ?? [],
        checks: checks.filter((step: { item_id: string }) => step.item_id === row.item_id).map((step: { id: string; label: string; assignment_id: string | null }) => ({
          id: step.id, label: step.label, ticked: step.assignment_id === row.id,
        })),
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
    const scope = await viewerScope(a);
    const items = (await pool.query(
      `select i.id, i.title, i.category, i.share, i.locked, i.required_before_unsupervised required, i.certificate, i.valid_months, i.example, i.link, i.description, s.title sop_title, (i.attachment is not null) has_attachment,
              coalesce((select json_agg(md.department order by md.sort_order) from training_module_dept md where md.item_id = i.id), '[]') departments
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
    if (!scope.all) {
      shownItems = shownItems.filter((item: { share: ModuleShare; departments: string[] | null }) => moduleVisible({ share: item.share, departments: item.departments ?? [] }, scope));
    }
    if (category) shownItems = shownItems.filter((item: { category: string }) => item.category === category);
    let shownPeople = people;
    if (!scope.all) shownPeople = shownPeople.filter((person: { department: string | null }) => !!person.department && scope.departments.includes(person.department));
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
    return {
      today,
      categories: TRAINING_CATEGORIES,
      scope,
      items: shownItems.map((item: any) => ({ ...item, departments: item.departments ?? [], category_label: categoryLabel(item.category) })),
      people: filtered,
      sops,
      templates,
      roles,
      departments,
    };
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
      const template = (await c.query(
        `select department from training_template where id=$1 and property_id=$2`,
        [templateId, a.propertyId],
      )).rows[0];
      if (!template) { reply.code(404); return problem(404, "not_found", "That induction is not on the list"); }
      const explicit = (await c.query(
        `select ti.item_id from training_template_item ti where ti.template_id=$1`,
        [templateId],
      )).rows.map((row: { item_id: string }) => row.item_id);
      const mods = (await c.query(
        `select i.id, i.title, i.share,
                coalesce(array_agg(md.department) filter (where md.department is not null), '{}') departments
         from training_item i
         left join training_module_dept md on md.item_id = i.id
         where i.property_id=$1 and i.active
         group by i.id`,
        [a.propertyId],
      )).rows;
      const itemIds = inductionItemIds(
        { department: template.department, itemIds: explicit },
        mods.map((row: { id: string; title: string; share: ModuleShare; departments: string[] }) => ({
          id: row.id, title: row.title, share: row.share, departments: row.departments ?? [],
        })),
      );
      const items = itemIds.map(id => ({ id }));
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
        `update training_assignment set status='completed', signed_off_at=now(), signed_off_by=$2, signed_off_name=$3, notes=$4, certificate=coalesce($5, certificate), issued_on=$6, expires_on=$7, signed_off_version=(select checklist_version from training_item where id=$8) where id=$1`,
        [row.id, a.userId, a.name, notes, file.file, issued || null, expires || null, row.item_id],
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

  f.post("/v1/induction/assignments/:id/ticks", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "training.self", reply)) return;
    const checkId = String(req.body?.check_id ?? "");
    const ticked = req.body?.ticked !== false;
    if (!/^[0-9a-f-]{36}$/i.test(checkId)) return reply.code(422).send(problem(422, "validation", "Choose a step on the checklist"));
    const scope = await viewerScope(a);
    const saved = await tx(async c => {
      const row = (await c.query(
        `select a.id, a.status, a.signed_off_at, a.item_id, i.share,
                coalesce(array_agg(md.department) filter (where md.department is not null), '{}') departments
         from training_assignment a
         join training_item i on i.id = a.item_id
         left join training_module_dept md on md.item_id = i.id
         where a.id=$1 and a.property_id=$2 and a.user_id=$3
         group by a.id, i.share`,
        [req.params.id, a.propertyId, a.userId],
      )).rows[0];
      if (!row) { reply.code(404); return problem(404, "not_found", "That item is not on your list"); }
      if (!moduleVisible({ share: row.share, departments: row.departments ?? [] }, scope)) {
        reply.code(404); return problem(404, "not_found", "That item is not on your list");
      }
      if (row.signed_off_at) { reply.code(422); return problem(422, "validation", "A manager has already signed this off"); }
      const step = (await c.query(`select id from training_check where id=$1 and item_id=$2`, [checkId, row.item_id])).rows[0];
      if (!step) { reply.code(404); return problem(404, "not_found", "That step is not on this module"); }
      if (ticked) await c.query(`insert into training_tick (assignment_id, check_id) values ($1,$2) on conflict do nothing`, [row.id, checkId]);
      else await c.query(`delete from training_tick where assignment_id=$1 and check_id=$2`, [row.id, checkId]);
      const open = (await c.query(
        `select count(*)::int total,
                count(*) filter (where not exists (select 1 from training_tick t where t.check_id=c.id and t.assignment_id=$2))::int left_steps
         from training_check c where c.item_id=$1`,
        [row.item_id, row.id],
      )).rows[0];
      const total = Number(open?.total ?? 0);
      const left = Number(open?.left_steps ?? 0);
      if (total > 0 && left === 0) {
        await c.query(`update training_assignment set status='in_progress', done_at=coalesce(done_at, now()) where id=$1`, [row.id]);
      } else if (row.status === "in_progress") {
        await c.query(`update training_assignment set status='not_started' where id=$1`, [row.id]);
      }
      return { ok: true, waiting: total > 0 && left === 0 };
    });
    return saved;
  });

  f.get("/v1/induction/modules", async (req, reply) => {
    const a = await actor(req, reply); if (!a) return;
    if (!canManage(a) && !canSign(a)) return reply.code(403).send(problem(403, "forbidden", "You cannot open the training modules"));
    const scope = await viewerScope(a);
    const departments = (await pool.query(`select code, name from department where property_id=$1 order by name`, [a.propertyId])).rows;
    const rows = (await pool.query(
      `select i.id, i.title, i.description, i.category, i.share, i.locked, i.example, i.required_before_unsupervised required,
              i.certificate, i.valid_months, i.checklist_version,
              coalesce((select json_agg(json_build_object('code', md.department, 'sort_order', md.sort_order) order by md.sort_order, md.department) from training_module_dept md where md.item_id=i.id), '[]') departments,
              coalesce((select json_agg(json_build_object('id', c.id, 'label', c.label, 'sort_order', c.sort_order) order by c.sort_order, c.label) from training_check c where c.item_id=i.id), '[]') checks
       from training_item i
       where i.property_id=$1 and i.active
       order by i.title`,
      [a.propertyId],
    )).rows;
    const modules = rows
      .map((row: any) => ({
        ...row,
        departments: row.departments ?? [],
        checks: row.checks ?? [],
        category_label: categoryLabel(row.category),
        can_edit: canEditModule(scope, { share: row.share, departments: (row.departments ?? []).map((d: { code: string }) => d.code) }),
      }))
      .filter((row: any) => moduleVisible({ share: row.share, departments: row.departments.map((d: { code: string }) => d.code) }, scope));
    return { scope, departments, modules };
  });

  f.post("/v1/induction/modules", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "training.manage", reply)) return;
    const parsed = parseTrainingItem(req.body ?? {});
    if (!parsed.ok) return reply.code(422).send(problem(422, "validation", parsed.error));
    const share = nextShare({ share: "department", locked: false }, {
      mandatoryAll: req.body?.mandatory_all === true,
      shared: req.body?.shared === true,
    });
    if (!share.ok) return reply.code(422).send(problem(422, "validation", share.error));
    const scope = await viewerScope(a);
    if (share.share === "all" && !scope.all) return reply.code(403).send(problem(403, "forbidden", "Only the general manager can put a module on every department"));
    const rawList: unknown[] = Array.isArray(req.body?.departments) ? req.body.departments : [req.body?.department];
    const listed = rawList.map(value => deptCode(value)).filter(code => code !== "");
    const departments = share.share === "all" ? await propertyDepartments(a.propertyId) : [...new Set(listed)];
    if (!departments.length) return reply.code(422).send(problem(422, "validation", "Choose a department"));
    if (departments.some(code => !canEditDepartment(scope, code))) return reply.code(403).send(problem(403, "forbidden", "You can edit modules for your own department"));
    const checks = planChecklistEdit([], Array.isArray(req.body?.checks) ? req.body.checks : [], false);
    if (!checks.ok) return reply.code(422).send(problem(422, "validation", checks.error));
    const saved = await tx(async c => {
      const row = (await c.query(
        `insert into training_item (tenant_id, property_id, title, description, category, required_before_unsupervised, certificate, valid_months, share, locked)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,false) returning id`,
        [a.tenantId, a.propertyId, parsed.title, parsed.description || null, parsed.category, parsed.required, parsed.certificate, parsed.validMonths, share.share],
      )).rows[0];
      let sort = 1;
      for (const code of departments) {
        await c.query(`insert into training_module_dept (item_id, department, sort_order) values ($1,$2,$3) on conflict do nothing`, [row.id, code, share.share === "all" ? 0 : sort]);
        sort += 1;
      }
      await applyChecklist(c, a, row.id, checks);
      await audit(c, a, "training_item", row.id, "training.module", { payload: { title: parsed.title, departments } });
      return row;
    });
    reply.code(201);
    return { id: saved.id };
  });

  f.patch("/v1/induction/modules/:id", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "training.manage", reply)) return;
    const scope = await viewerScope(a);
    const saved = await tx(async c => {
      const row = (await c.query(
        `select * from training_item where id=$1 and property_id=$2 for update`,
        [req.params.id, a.propertyId],
      )).rows[0];
      if (row) {
        row.departments = (await c.query(`select department from training_module_dept where item_id=$1`, [row.id])).rows.map((dept: { department: string }) => dept.department);
      }
      if (!row || !row.active) { reply.code(404); return problem(404, "not_found", "That module is not in the library"); }
      const currentDepartments: string[] = row.departments ?? [];
      if (!canEditModule(scope, { share: row.share, departments: currentDepartments })) {
        reply.code(403); return problem(403, "forbidden", "You can edit modules for your own department");
      }
      const parsed = parseTrainingItem({
        title: req.body?.title ?? row.title,
        description: req.body?.description ?? row.description,
        category: req.body?.category ?? row.category,
        required: req.body?.required ?? row.required_before_unsupervised,
        certificate: req.body?.certificate ?? row.certificate,
        valid_months: req.body?.valid_months ?? req.body?.valid_years ?? row.valid_months,
        valid_years: req.body?.valid_years,
        sop_id: req.body?.sop_id ?? row.sop_id,
        link: req.body?.link ?? row.link,
      });
      if (!parsed.ok) { reply.code(422); return problem(422, "validation", parsed.error); }
      let share: ModuleShare = row.share;
      if (req.body?.mandatory_all != null || req.body?.shared != null) {
        const decided = nextShare({ share: row.share, locked: row.locked }, {
          mandatoryAll: req.body?.mandatory_all,
          shared: req.body?.shared,
        });
        if (!decided.ok) { reply.code(422); return problem(422, "validation", decided.error); }
        if (decided.share === "all" && !scope.all && row.share !== "all") {
          reply.code(403); return problem(403, "forbidden", "Only the general manager can put a module on every department");
        }
        if (!scope.all && row.share === "all" && decided.share !== "all") {
          reply.code(403); return problem(403, "forbidden", "Only the general manager can take this module off a department");
        }
        share = decided.share;
      }
      let departments = currentDepartments;
      if (share === "all") departments = await propertyDepartments(a.propertyId);
      else if (Array.isArray(req.body?.departments)) departments = [...new Set((req.body.departments as unknown[]).map(deptCode).filter((code): code is string => !!code))];
      if (share !== "all" && !departments.length) { reply.code(422); return problem(422, "validation", "Choose a department"); }
      for (const code of departments) {
        if (!currentDepartments.includes(code) && !canEditDepartment(scope, code)) {
          reply.code(403); return problem(403, "forbidden", "You can edit modules for your own department");
        }
      }
      for (const code of currentDepartments) {
        if (departments.includes(code)) continue;
        const detached = detachModule({ share: row.locked ? "all" : share, locked: row.locked, departments: currentDepartments }, code);
        if (!detached.ok) { reply.code(422); return problem(422, "validation", detached.error); }
        if (!canEditDepartment(scope, code)) { reply.code(403); return problem(403, "forbidden", "You can edit modules for your own department"); }
      }
      if (share !== "all" && departments.length < 2) share = "department";
      if (share === "department") departments = departments.slice(0, 1);
      await c.query(
        `update training_item set title=$2, description=$3, category=$4, required_before_unsupervised=$5, certificate=$6, valid_months=$7, share=$8, example=false, updated_at=now() where id=$1`,
        [row.id, parsed.title, parsed.description || null, parsed.category, parsed.required, parsed.certificate, parsed.validMonths, share],
      );
      if (share === "all") await replaceDepartments(c, row.id, a.propertyId, share);
      else {
        await c.query(`delete from training_module_dept where item_id=$1 and not (department = any($2::text[]))`, [row.id, departments]);
        for (const code of departments) {
          await c.query(
            `insert into training_module_dept (item_id, department, sort_order)
             values ($1,$2, coalesce((select max(sort_order) + 1 from training_module_dept where item_id=$1), 1))
             on conflict (item_id, department) do nothing`,
            [row.id, code],
          );
        }
      }
      if (Array.isArray(req.body?.checks)) {
        const current = (await c.query(`select id, label from training_check where item_id=$1 order by sort_order, label`, [row.id])).rows;
        const plan = planChecklistEdit(current, req.body.checks, req.body?.requires_retraining === true);
        if (!plan.ok) { reply.code(422); return problem(422, "validation", plan.error); }
        await applyChecklist(c, a, row.id, plan);
      }
      await audit(c, a, "training_item", row.id, "training.module", { payload: { title: parsed.title, share, requires_retraining: req.body?.requires_retraining === true } });
      return { ok: true };
    });
    return saved;
  });

  f.delete("/v1/induction/modules/:id", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "training.manage", reply)) return;
    const row = await moduleRow(a.propertyId, req.params.id);
    if (!row || !row.active) return reply.code(404).send(problem(404, "not_found", "That module is not in the library"));
    if (row.locked || row.share === "all") {
      return reply.code(422).send(problem(422, "validation", "This module stays on every department. You can edit it, not remove it."));
    }
    const scope = await viewerScope(a);
    if (!canEditModule(scope, row)) return reply.code(403).send(problem(403, "forbidden", "You can edit modules for your own department"));
    await tx(async c => {
      await c.query(`update training_item set active=false, updated_at=now() where id=$1`, [row.id]);
      await audit(c, a, "training_item", row.id, "training.module.remove", { payload: { title: row.title } });
    });
    return { ok: true };
  });

  f.delete("/v1/induction/modules/:id/departments/:code", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "training.manage", reply)) return;
    const code = deptCode(req.params.code);
    const row = await moduleRow(a.propertyId, req.params.id);
    if (!row) return reply.code(404).send(problem(404, "not_found", "That module is not in the library"));
    const detached = detachModule(row, code);
    if (!detached.ok) return reply.code(422).send(problem(422, "validation", detached.error));
    const scope = await viewerScope(a);
    if (!canEditDepartment(scope, code)) return reply.code(403).send(problem(403, "forbidden", "You can edit modules for your own department"));
    await pool.query(`delete from training_module_dept where item_id=$1 and department=$2`, [row.id, code]);
    if (detached.departments.length < 2 && row.share === "selected") {
      await pool.query(`update training_item set share='department', updated_at=now() where id=$1`, [row.id]);
    }
    return { ok: true, departments: detached.departments };
  });

  f.post("/v1/induction/modules/reorder", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "training.manage", reply)) return;
    const department = deptCode(req.body?.department);
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((id: unknown) => String(id)) : [];
    if (!department || !ids.length) return reply.code(422).send(problem(422, "validation", "Choose a department and the module order"));
    const scope = await viewerScope(a);
    if (!canEditDepartment(scope, department)) return reply.code(403).send(problem(403, "forbidden", "You can edit modules for your own department"));
    await tx(async c => {
      let sort = 0;
      for (const id of ids) {
        if (!/^[0-9a-f-]{36}$/i.test(id)) continue;
        await c.query(
          `update training_module_dept set sort_order=$3 where item_id=$1 and department=$2`,
          [id, department, sort],
        );
        sort += 1;
      }
    });
    return { ok: true };
  });
}
