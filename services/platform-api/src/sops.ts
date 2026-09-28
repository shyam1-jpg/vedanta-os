/**
 * SOP library. sop.read can open them. sop.manage can create, edit, delete and assign.
 */
import type { FastifyInstance } from "fastify";
import { pool } from "./db.ts";
import { requireActor, allow, problem, type Actor } from "./auth.ts";
import { uniqueSlug } from "../../../domains/ops/sop.ts";

async function reader(req: any, reply: any): Promise<Actor | null> {
  const a = await requireActor(req, reply);
  if (!a) return null;
  if (!a.perms.has("sop.read") && !a.perms.has("sop.manage")) {
    reply.code(403).send(problem(403, "forbidden", "You cannot open SOPs"));
    return null;
  }
  return a;
}

async function editor(req: any, reply: any): Promise<Actor | null> {
  const a = await requireActor(req, reply);
  if (!a || !allow(a, "sop.manage", reply)) return null;
  return a;
}

const COLS = `s.id, s.title, s.body, s.department, s.slug, s.status, s.created_at, s.updated_at,
  (select count(*)::int from staff_sop_assignment a where a.sop_id=s.id) as assigned`;

export default async function sopRoutes(f: FastifyInstance) {
  f.get("/v1/sops", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const department = String(req.query?.department ?? "");
    const slug = String(req.query?.slug ?? "");
    const r = await pool.query(
      `select ${COLS} from staff_sop s
       where s.property_id=$1 and ($2='' or s.department=$2) and ($3='' or s.slug=$3)
       order by coalesce(s.department, 'ZZZ'), s.title`,
      [a.propertyId, department, slug],
    );
    const departments = (await pool.query(`select code, name from department where property_id=$1 order by sort_order, name`, [a.propertyId])).rows;
    const people = a.perms.has("sop.manage")
      ? (await pool.query(
        `select distinct on (u.id) u.id, u.display_name as name from app_user u join membership m on m.user_id=u.id
         where m.property_id=$1 and u.status='ACTIVE' order by u.id, u.display_name`,
        [a.propertyId],
      )).rows.sort((x: { name: string }, y: { name: string }) => x.name.localeCompare(y.name))
      : [];
    return { items: r.rows, can_manage: a.perms.has("sop.manage"), departments, people };
  });

  f.get<{ Params: { id: string } }>("/v1/sops/:id", async (req, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const sop = (await pool.query(`select ${COLS} from staff_sop s where s.id=$1 and s.property_id=$2`, [req.params.id, a.propertyId])).rows[0];
    if (!sop) return reply.code(404).send(problem(404, "not_found", "No such SOP"));
    const people = (await pool.query(
      `select u.id, u.display_name as name, a.read_at from staff_sop_assignment a join app_user u on u.id=a.user_id where a.sop_id=$1 order by u.display_name`,
      [sop.id],
    )).rows;
    return { ...sop, people };
  });

  f.post("/v1/sops", async (req: any, reply) => {
    const a = await editor(req, reply); if (!a) return;
    const title = String(req.body?.title ?? "").trim();
    const body = String(req.body?.body ?? "").trim();
    if (!title || !body) return reply.code(422).send(problem(422, "validation", "A title and the procedure are required"));
    const taken = (await pool.query(`select slug from staff_sop where property_id=$1 and slug is not null`, [a.propertyId])).rows.map((r: { slug: string }) => r.slug);
    const slug = uniqueSlug(String(req.body?.slug || title), taken);
    const department = req.body?.department ? String(req.body.department) : null;
    const row = (await pool.query(
      `insert into staff_sop (tenant_id, property_id, title, body, department, slug, status, created_by)
       values ($1,$2,$3,$4,$5,$6,'live',$7) returning id, slug`,
      [a.tenantId, a.propertyId, title, body, department, slug, a.userId],
    )).rows[0];
    await assign(a, row.id, req.body?.user_ids ?? [], department);
    reply.code(201);
    return row;
  });

  f.patch("/v1/sops/:id", async (req: any, reply) => {
    const a = await editor(req, reply); if (!a) return;
    const current = (await pool.query(`select id, title, slug from staff_sop where id=$1 and property_id=$2`, [req.params.id, a.propertyId])).rows[0];
    if (!current) return reply.code(404).send(problem(404, "not_found", "No such SOP"));
    const title = req.body?.title != null ? String(req.body.title).trim() : current.title;
    let slug = current.slug;
    if (req.body?.slug || (req.body?.title && !current.slug)) {
      const taken = (await pool.query(`select slug from staff_sop where property_id=$1 and id<>$2 and slug is not null`, [a.propertyId, current.id])).rows.map((r: { slug: string }) => r.slug);
      slug = uniqueSlug(String(req.body.slug || title), taken);
    }
    const department = "department" in (req.body ?? {}) ? (req.body.department || null) : undefined;
    await pool.query(
      `update staff_sop set title=$3, body=coalesce($4, body), slug=$5,
         department=case when $6::bool then $7 else department end, updated_at=now()
       where id=$1 and property_id=$2`,
      [current.id, a.propertyId, title, req.body?.body ?? null, slug, department !== undefined, department ?? null],
    );
    if (Array.isArray(req.body?.user_ids) || req.body?.assign_department) {
      await assign(a, current.id, req.body?.user_ids ?? [], req.body?.assign_department ?? null);
    }
    return { ok: true, slug };
  });

  f.delete<{ Params: { id: string } }>("/v1/sops/:id", async (req, reply) => {
    const a = await editor(req, reply); if (!a) return;
    const r = await pool.query(`delete from staff_sop where id=$1 and property_id=$2`, [req.params.id, a.propertyId]);
    if (!r.rowCount) return reply.code(404).send(problem(404, "not_found", "No such SOP"));
    return { ok: true };
  });
}

async function assign(a: Actor, sopId: string, userIds: string[], department: string | null) {
  const ids = new Set<string>(userIds.filter(Boolean));
  if (department) {
    const people = (await pool.query(
      `select u.id from app_user u join membership m on m.user_id=u.id join department d on d.id=m.department_id
       where m.property_id=$1 and d.code=$2 and u.status='ACTIVE'`,
      [a.propertyId, department],
    )).rows;
    for (const person of people) ids.add(person.id);
    await pool.query(`update staff_sop set department=$2, updated_at=now() where id=$1`, [sopId, department]);
  }
  for (const id of ids) {
    await pool.query(`insert into staff_sop_assignment (sop_id, user_id) values ($1,$2) on conflict do nothing`, [sopId, id]);
  }
}
