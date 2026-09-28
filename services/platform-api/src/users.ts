import type { FastifyInstance } from "fastify";
import { pool, tx, type Q } from "./db.ts";
import { requireActor, allow, problem } from "./auth.ts";
import { audit } from "./groups.ts";
import { moveNameAcrossHouse } from "./people.ts";

/** Staff accounts. Sign-in proves identity (Microsoft); this decides who has access and as what. */
export default async function routes(f: FastifyInstance) {
  f.get("/users", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "user.manage", reply)) return;
    const r = await pool.query(`select distinct on (u.id) u.id, u.email, u.display_name name, u.status, r.code role, r.name role_name, d.code department, d.name department_name,
        s.code section, s.name section_name, u.created_at,
        (select max(created_at) from session s2 where s2.user_id=u.id) last_sign_in
      from app_user u left join membership m on m.user_id=u.id and m.property_id=$2 left join role r on r.id=m.role_id left join department d on d.id=m.department_id
      left join department_section s on s.id=m.section_id
      where u.tenant_id=$1 order by u.id, u.status, r.code, u.display_name`, [a.tenantId, a.propertyId]);
    const roles = await pool.query(`select code, name from role where tenant_id=$1 order by name`, [a.tenantId]);
    const depts = await pool.query(`select code, name from department where property_id=$1 order by sort_order, name`, [a.propertyId]);
    const sections = await pool.query(`select s.code, s.name, d.code department from department_section s join department d on d.id=s.department_id where s.property_id=$1 order by d.sort_order, s.name`, [a.propertyId]);
    const items = r.rows.sort((a: { status: string; name: string }, b: { status: string; name: string }) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name));
    return { items, roles: roles.rows, departments: depts.rows, sections: sections.rows };
  });

  f.post<{ Body: { email: string; name: string; role: string; department?: string; section?: string } }>("/users", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "user.manage", reply)) return;
    const { email, name, role, department, section } = req.body ?? {};
    if (!email?.includes("@") || !name || !role) return reply.code(422).send(problem(422, "validation", "email, name and role are required"));
    return tx(async c => {
      const dup = await c.query(`select 1 from app_user where tenant_id=$1 and lower(email)=lower($2)`, [a.tenantId, email]);
      if (dup.rowCount) { reply.code(409); return problem(409, "exists", "There is already a user with that email"); }
      const ro = (await c.query(`select id from role where tenant_id=$1 and code=$2`, [a.tenantId, role])).rows[0];
      if (!ro) { reply.code(422); return problem(422, "validation", "Unknown role"); }
      const dep = department ? (await c.query(`select id from department where property_id=$1 and code=$2`, [a.propertyId, department])).rows[0] : null;
      if (department && !dep) { reply.code(422); return problem(422, "validation", "Unknown department"); }
      const sec = await sectionRow(c, dep?.id ?? null, section);
      if (section && !sec) { reply.code(422); return problem(422, "validation", "That sub-section is not in this department"); }
      const u = (await c.query(`insert into app_user (tenant_id, email, display_name, status) values ($1, lower($2), $3, 'ACTIVE') returning id`, [a.tenantId, email.trim(), name.trim()])).rows[0];
      await c.query(`insert into membership (tenant_id, user_id, property_id, role_id, department_id, section_id) values ($1,$2,$3,$4,$5,$6)`, [a.tenantId, u.id, a.propertyId, ro.id, dep?.id ?? null, sec?.id ?? null]);
      await audit(c, a, "app_user", u.id, "user.create", { payload: { email, role, department, section } });
      reply.code(201); return { id: u.id };
    });
  });

  f.patch<{ Params: { id: string }; Body: { role?: string; status?: string; name?: string; department?: string; section?: string | null } }>("/users/:id", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "user.manage", reply)) return;
    const { role, status, name, department, section } = req.body ?? {};
    if (req.params.id === a.userId && status && status !== "ACTIVE") return reply.code(409).send(problem(409, "self", "You cannot deactivate yourself"));
    return tx(async c => {
      const u = (await c.query(`select id, display_name, email from app_user where id=$1 and tenant_id=$2`, [req.params.id, a.tenantId])).rows[0];
      if (!u) { reply.code(404); return problem(404, "not_found", "No such user"); }
      let moved = { occupancy: 0, guest_accounts: 0, enquiries: 0, bookings: 0 };
      if (name) {
        const next = name.trim();
        await c.query(`update app_user set display_name=$2 where id=$1`, [u.id, next]);
        moved = await moveNameAcrossHouse(c, { propertyId: a.propertyId, oldName: u.display_name, newName: next, email: u.email });
      }
      if (status) {
        if (!["ACTIVE", "SUSPENDED", "LEFT"].includes(status)) { reply.code(422); return problem(422, "validation", "Bad status"); }
        await c.query(`update app_user set status=$2 where id=$1`, [u.id, status]);
        if (status !== "ACTIVE") await c.query(`delete from session where user_id=$1`, [u.id]);
      }
      if (role) {
        const ro = (await c.query(`select id from role where tenant_id=$1 and code=$2`, [a.tenantId, role])).rows[0];
        if (!ro) { reply.code(422); return problem(422, "validation", "Unknown role"); }
        if (u.id === a.userId && a.role === "SYSTEM_OWNER" && role !== "SYSTEM_OWNER") { reply.code(409); return problem(409, "self", "You cannot remove your own system-owner role"); }
        const dep = department ? (await c.query(`select id from department where property_id=$1 and code=$2`, [a.propertyId, department])).rows[0] : null;
        if (department && !dep) { reply.code(422); return problem(422, "validation", "Unknown department"); }
        const sec = await sectionRow(c, dep?.id ?? null, section);
        if (section && !sec) { reply.code(422); return problem(422, "validation", "That sub-section is not in this department"); }
        await c.query(`delete from membership where user_id=$1 and property_id=$2`, [u.id, a.propertyId]);
        await c.query(`insert into membership (tenant_id, user_id, property_id, role_id, department_id, section_id) values ($1,$2,$3,$4,$5,$6)`, [a.tenantId, u.id, a.propertyId, ro.id, dep?.id ?? null, sec?.id ?? null]);
        await c.query(`delete from session where user_id=$1`, [u.id]);
      } else if (department !== undefined || section !== undefined) {
        const current = (await c.query(`select department_id from membership where user_id=$1 and property_id=$2 limit 1`, [u.id, a.propertyId])).rows[0];
        const dep = department !== undefined
          ? (department ? (await c.query(`select id from department where property_id=$1 and code=$2`, [a.propertyId, department])).rows[0] : null)
          : (current ? { id: current.department_id } : null);
        if (department && !dep) { reply.code(422); return problem(422, "validation", "Unknown department"); }
        const sec = section !== undefined ? await sectionRow(c, dep?.id ?? null, section) : undefined;
        if (section && !sec) { reply.code(422); return problem(422, "validation", "That sub-section is not in this department"); }
        if (department !== undefined && section !== undefined) {
          await c.query(`update membership set department_id=$3, section_id=$4 where user_id=$1 and property_id=$2`, [u.id, a.propertyId, dep?.id ?? null, sec?.id ?? null]);
        } else if (department !== undefined) {
          await c.query(`update membership set department_id=$3, section_id=null where user_id=$1 and property_id=$2`, [u.id, a.propertyId, dep?.id ?? null]);
        } else {
          await c.query(`update membership set section_id=$3 where user_id=$1 and property_id=$2`, [u.id, a.propertyId, sec?.id ?? null]);
        }
      }
      await audit(c, a, "app_user", u.id, "user.update", { payload: { ...req.body, moved } });
      return { ok: true, moved };
    });
  });

  f.patch<{ Params: { code: string }; Body: { name?: string } }>("/departments/sections/:code", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "user.manage", reply)) return;
    const name = String(req.body?.name ?? "").trim();
    const department = String((req.query as { department?: string })?.department ?? "").trim();
    if (!name) return reply.code(422).send(problem(422, "validation", "A sub-section needs a name"));
    const r = await pool.query(
      `update department_section s set name=$3
       from department d
       where s.department_id=d.id and d.property_id=$1 and s.code=$2 and ($4='' or d.code=$4)
       returning s.code, s.name, d.code department`,
      [a.propertyId, req.params.code, name, department],
    );
    if (!r.rowCount) return reply.code(404).send(problem(404, "not_found", "No such sub-section"));
    return r.rows[0];
  });

  f.post<{ Body: { department: string; code: string; name: string } }>("/departments/sections", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "user.manage", reply)) return;
    const department = String(req.body?.department ?? "").trim();
    const code = String(req.body?.code ?? "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "");
    const name = String(req.body?.name ?? "").trim();
    if (!department || !code || !name) return reply.code(422).send(problem(422, "validation", "department, code and name are required"));
    const dep = (await pool.query(`select id from department where property_id=$1 and code=$2`, [a.propertyId, department])).rows[0];
    if (!dep) return reply.code(422).send(problem(422, "validation", "Unknown department"));
    const r = await pool.query(
      `insert into department_section (tenant_id, property_id, department_id, code, name) values ($1,$2,$3,$4,$5)
       on conflict (department_id, code) do update set name=excluded.name
       returning code, name`,
      [a.tenantId, a.propertyId, dep.id, code, name],
    );
    return r.rows[0];
  });
}

async function sectionRow(c: Q, departmentId: string | null, section?: string | null) {
  if (!section) return null;
  if (!departmentId) return null;
  return (await c.query(`select id from department_section where department_id=$1 and code=$2`, [departmentId, section])).rows[0] ?? null;
}
