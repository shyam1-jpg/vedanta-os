/** Organisation tree. Contact details are filtered before they leave this file. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { pool, tx, type Q } from "./db.ts";
import { requireActor, allow, problem, type Actor } from "./auth.ts";
import { openText, sealText } from "./fieldCrypto.ts";
import { audit } from "./groups.ts";
import { clearanceForUsers } from "./training.ts";
import {
  buildLadder,
  canEditOrg,
  departmentScope,
  directReports,
  dropOnDepartment,
  parseOrgImport,
  parseOrgSettings,
  reassign,
  snapshot,
  structureCycle,
  trainingLabel,
  trainingStatus,
  undoChange,
  visibleContact,
  weekRange,
  type OrgLevel,
  type OrgSeat,
  type OrgSnapshot,
  type OrgViewer,
} from "../../../domains/staff/hierarchy.ts";

const CODE = /^[A-Z0-9_]{2,24}$/;

async function londonToday(): Promise<string> {
  const row = (await pool.query(`select to_char(timezone('Europe/London', now()), 'YYYY-MM-DD') as date`)).rows[0];
  return String(row.date);
}

function editor(a: Actor, reply: { code: (n: number) => { send: (b: unknown) => unknown } }): boolean {
  if (canEditOrg(a.role, a.perms)) return true;
  reply.code(403).send(problem(403, "forbidden", "Only the system owner and the general manager can change the tree"));
  return false;
}

async function settingsFor(propertyId: string) {
  const row = (await pool.query(`select settings->'org' org from property where id=$1`, [propertyId])).rows[0];
  return parseOrgSettings(row?.org);
}

async function loadSeats(c: Q | typeof pool, propertyId: string): Promise<OrgSeat[]> {
  const rows = (await c.query(
    `select pos.id, pos.title, pos.level, pos.reports_to, pos.holder_id, pos.work_phone, pos.personal_phone,
            d.code department, d.name department_name, u.display_name holder_name, u.email,
            coalesce((select json_agg(dt.to_id) from org_dotted dt where dt.from_id = pos.id), '[]') dotted
     from org_position pos
     join department d on d.id = pos.department_id
     left join app_user u on u.id = pos.holder_id
     where pos.property_id=$1 and pos.active
     order by d.sort_order, pos.sort_order, pos.title`,
    [propertyId],
  )).rows as {
    id: string; title: string; level: OrgLevel; reports_to: string | null; holder_id: string | null;
    work_phone: string | null; personal_phone: string | null; department: string; department_name: string;
    holder_name: string | null; email: string | null; dotted: string[];
  }[];
  const ids = rows.map(row => row.holder_id).filter((id): id is string => !!id);
  const cleared = await clearanceForUsers(propertyId, ids);
  const counts = new Map<string, number>();
  if (ids.length) {
    const assigned = (await c.query(
      `select user_id, count(*)::int n from training_assignment where property_id=$1 and user_id = any($2::uuid[]) group by user_id`,
      [propertyId, ids],
    )).rows as { user_id: string; n: number }[];
    for (const row of assigned) counts.set(row.user_id, row.n);
  }
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    department: row.department,
    departmentName: row.department_name,
    level: row.level,
    holderId: row.holder_id,
    holderName: row.holder_name,
    managerId: row.reports_to,
    dottedIds: row.dotted ?? [],
    training: row.holder_id ? trainingStatus(counts.get(row.holder_id) ?? 0, cleared.get(row.holder_id) ?? false) : "none",
    email: row.email,
    personalPhone: openText(row.personal_phone),
    workPhone: row.work_phone,
  }));
}

async function departments(c: Q | typeof pool, propertyId: string) {
  const rows = (await c.query(
    `select d.code, d.name, parent.code parent
     from department d
     left join department parent on parent.id = d.parent_id
     where d.property_id=$1
     order by d.sort_order, d.name`,
    [propertyId],
  )).rows as { code: string; name: string; parent: string | null }[];
  return rows;
}

function viewer(a: Actor, seats: OrgSeat[]): OrgViewer {
  return { userId: a.userId, role: a.role, positionIds: seats.filter(seat => seat.holderId === a.userId).map(seat => seat.id) };
}

function publicSeat(seat: OrgSeat) {
  return {
    id: seat.id,
    name: seat.holderName || "Vacant",
    vacant: !seat.holderName,
    title: seat.title,
    department: seat.department,
    department_name: seat.departmentName,
    level: seat.level,
    reports: 0,
    training: seat.training,
    training_label: trainingLabel(seat.training),
  };
}

async function saveSeat(c: Q, propertyId: string, before: OrgSeat, after: OrgSeat) {
  const dept = (await c.query(`select id from department where property_id=$1 and code=$2`, [propertyId, after.department])).rows[0];
  if (!dept) {
    const err = new Error("Choose a department");
    (err as { status?: number }).status = 422;
    throw err;
  }
  await c.query(
    `update org_position set title=$2, level=$3, department_id=$4, reports_to=$5, updated_at=now() where id=$1 and property_id=$6`,
    [after.id, after.title, after.level, dept.id, after.managerId, propertyId],
  );
  await c.query(`delete from org_dotted where from_id=$1`, [after.id]);
  for (const toId of after.dottedIds) {
    await c.query(
      `insert into org_dotted (property_id, from_id, to_id) values ($1,$2,$3) on conflict do nothing`,
      [propertyId, after.id, toId],
    );
  }
  return before;
}

function localImportFile(): unknown | null {
  const roots = [process.cwd(), resolve(process.cwd(), "../..")];
  const names = ["db/import/staff-org.local.json", "db/import/staff-teams.local.json"];
  for (const root of roots) {
    for (const name of names) {
      const path = resolve(root, name);
      if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
    }
  }
  return null;
}

function positionCode(email: string): string {
  const local = email.split("@")[0].replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 18).toUpperCase() || "PERSON";
  const hash = createHash("sha256").update(email).digest("hex").slice(0, 6).toUpperCase();
  return `P-${local}-${hash}`;
}

export default async function orgRoutes(f: FastifyInstance) {
  f.get("/v1/org", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "org.read", reply)) return;
    const settings = await settingsFor(a.propertyId);
    const seats = await loadSeats(pool, a.propertyId);
    const depts = await departments(pool, a.propertyId);
    const filter = String(req.query?.department ?? "").trim().toUpperCase();
    const scope = filter ? departmentScope(filter, depts) : [];
    const tree = buildLadder(seats, filter || null, scope);
    const history = (await pool.query(
      `select c.id, c.effective_on::text, c.occurred_at, c.kind, c.summary, c.undone_at, u.display_name actor
       from org_change c left join app_user u on u.id = c.actor_id
       where c.property_id=$1 order by c.occurred_at desc limit 30`,
      [a.propertyId],
    )).rows;
    return {
      can_edit: canEditOrg(a.role, a.perms),
      allow_multiple_gm: settings.allowMultipleGm,
      staff_contact: settings.staffContact,
      department: filter || null,
      departments: depts,
      tree,
      people: seats.map(seat => ({ ...publicSeat(seat), reports: directReports(seats, seat.id) })),
      history: history.map((row: { undone_at: string | null }) => ({ ...row, undone: !!row.undone_at })),
    };
  });

  f.get("/v1/org/positions/:id", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "org.read", reply)) return;
    const seats = await loadSeats(pool, a.propertyId);
    const seat = seats.find(item => item.id === req.params.id);
    if (!seat) return reply.code(404).send(problem(404, "missing", "That position is not on the tree"));
    const settings = await settingsFor(a.propertyId);
    const contact = visibleContact(seat, viewer(a, seats), seats, settings.staffContact);
    const manager = seats.find(item => item.id === seat.managerId) ?? null;
    const today = await londonToday();
    const thisWeek = weekRange(today, 0);
    const nextWeek = weekRange(today, 1);
    const shifts = seat.holderId ? (await pool.query(
      `select shift_date::text as date, start_time::text as start, end_time::text as end, department
       from rota_shift
       where property_id=$1 and user_id=$2 and shift_date between $3 and $4 and status <> 'cancelled'
       order by shift_date, start_time`,
      [a.propertyId, seat.holderId, thisWeek.from, nextWeek.to],
    )).rows as { date: string; start: string; end: string; department: string }[] : [];
    return {
      ...publicSeat(seat),
      reports: directReports(seats, seat.id),
      manager: manager ? { id: manager.id, name: manager.holderName || "Vacant", title: manager.title } : null,
      dotted: seat.dottedIds.map(id => seats.find(item => item.id === id)).filter((item): item is OrgSeat => !!item).map(item => ({ id: item.id, name: item.holderName || "Vacant", title: item.title })),
      reports_to_them: seats.filter(item => item.managerId === seat.id).map(item => ({ id: item.id, name: item.holderName || "Vacant", title: item.title, vacant: !item.holderName })),
      contact,
      rota: {
        this_week: shifts.filter(shift => shift.date >= thisWeek.from && shift.date <= thisWeek.to),
        next_week: shifts.filter(shift => shift.date >= nextWeek.from && shift.date <= nextWeek.to),
      },
      can_edit: canEditOrg(a.role, a.perms),
    };
  });

  f.post("/v1/org/reassign", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "org.manage", reply) || !editor(a, reply)) return;
    const body = req.body ?? {};
    const positionId = String(body.position_id ?? "");
    const effectiveOn = String(body.effective_on ?? "");
    const settings = await settingsFor(a.propertyId);
    try {
      const saved = await tx(async c => {
        const seats = await loadSeats(c, a.propertyId);
        const current = seats.find(item => item.id === positionId);
        if (!current) { reply.code(404); return problem(404, "missing", "That position is not on the tree"); }
        const dotted = Array.isArray(body.dotted_ids) ? body.dotted_ids.map(String) : undefined;
        const result = body.department && body.manager_id === undefined && body.level === undefined
          ? dropOnDepartment(seats, positionId, String(body.department).toUpperCase(), effectiveOn, settings.allowMultipleGm)
          : reassign(seats, {
            positionId,
            managerId: body.manager_id === "" ? null : body.manager_id,
            department: body.department ? String(body.department).toUpperCase() : undefined,
            level: body.level,
            title: body.title,
            dottedIds: dotted,
            effectiveOn,
          }, { allowMultipleGm: settings.allowMultipleGm });
        if (!result.ok) { reply.code(422); return problem(422, "validation", result.error); }
        const after = result.seats.find(item => item.id === positionId)!;
        await saveSeat(c, a.propertyId, current, after);
        const manager = result.seats.find(item => item.id === after.managerId);
        const summary = `${current.holderName || current.title} now reports to ${manager ? (manager.holderName || manager.title) : "nobody"} in ${after.department}, from ${effectiveOn}`;
        const before: OrgSnapshot = snapshot(current);
        await c.query(
          `insert into org_change (tenant_id, property_id, position_id, actor_id, effective_on, kind, summary, before, after)
           values ($1,$2,$3,$4,$5,'reassign',$6,$7,$8)`,
          [a.tenantId, a.propertyId, positionId, a.userId, effectiveOn, summary, before, snapshot(after)],
        );
        await audit(c, a, "org_position", positionId, "org.reassign", { payload: { summary, effective_on: effectiveOn } });
        return { ok: true, summary };
      });
      return saved;
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 422) return reply.code(422).send(problem(422, "validation", (err as Error).message));
      throw err;
    }
  });

  f.post("/v1/org/undo", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "org.manage", reply) || !editor(a, reply)) return;
    const today = await londonToday();
    const saved = await tx(async c => {
      const change = (await c.query(
        `select id, position_id, before, summary from org_change
         where property_id=$1 and undone_at is null and kind <> 'undo'
         order by occurred_at desc limit 1`,
        [a.propertyId],
      )).rows[0] as { id: string; position_id: string; before: OrgSnapshot & { active?: boolean }; summary: string } | undefined;
      if (!change) { reply.code(404); return problem(404, "missing", "Nothing to undo"); }
      const before = change.before ?? {};
      if (before.active === false) {
        await c.query(`update org_position set active=false, updated_at=now() where id=$1 and property_id=$2`, [change.position_id, a.propertyId]);
      } else {
        const seats = await loadSeats(c, a.propertyId);
        const restored = undoChange(seats, before, change.position_id);
        if (!restored.ok) { reply.code(422); return problem(422, "validation", restored.error); }
        const after = restored.seats.find(item => item.id === change.position_id);
        const current = seats.find(item => item.id === change.position_id);
        if (after && current) await saveSeat(c, a.propertyId, current, after);
      }
      await c.query(`update org_change set undone_at=now(), undone_by=$2 where id=$1`, [change.id, a.userId]);
      const summary = `Undid: ${change.summary}`;
      await c.query(
        `insert into org_change (tenant_id, property_id, position_id, actor_id, effective_on, kind, summary, before, after)
         values ($1,$2,$3,$4,$5,'undo',$6,'{}','{}')`,
        [a.tenantId, a.propertyId, change.position_id, a.userId, today, summary],
      );
      await audit(c, a, "org_position", change.position_id, "org.undo", { payload: { summary } });
      return { ok: true, summary };
    });
    return saved;
  });

  f.post("/v1/org/positions", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "org.manage", reply) || !editor(a, reply)) return;
    const body = req.body ?? {};
    const title = String(body.title ?? "").trim();
    const department = String(body.department ?? "").trim().toUpperCase();
    const level = String(body.level ?? "staff");
    const effectiveOn = String(body.effective_on ?? await londonToday());
    if (title.length < 2) return reply.code(422).send(problem(422, "validation", "Give the position a title"));
    if (!CODE.test(department)) return reply.code(422).send(problem(422, "validation", "Choose a department"));
    const settings = await settingsFor(a.propertyId);
    try {
      return await tx(async c => {
        const dept = (await c.query(`select id from department where property_id=$1 and code=$2`, [a.propertyId, department])).rows[0];
        if (!dept) { reply.code(422); return problem(422, "validation", "Choose a department"); }
        let holder: string | null = null;
        const email = String(body.email ?? "").trim().toLowerCase();
        const name = String(body.name ?? "").trim();
        if (email) {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || name.length < 2) { reply.code(422); return problem(422, "validation", "A person needs a name and an email"); }
          const user = (await c.query(
            `insert into app_user (tenant_id, email, display_name) values ($1,$2,$3)
             on conflict (tenant_id, email) do update set display_name=excluded.display_name
             returning id`,
            [a.tenantId, email, name.slice(0, 80)],
          )).rows[0];
          holder = user.id;
        }
        const code = `S-${title.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 12) || "SEAT"}-${createHash("sha256").update(`${title}${Date.now()}`).digest("hex").slice(0, 4).toUpperCase()}`;
        const row = (await c.query(
          `insert into org_position (tenant_id, property_id, department_id, code, title, level, holder_id, work_phone, personal_phone, effective_from, example)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false) returning id`,
          [a.tenantId, a.propertyId, dept.id, code, title.slice(0, 80), level, holder, body.work_phone ? String(body.work_phone).slice(0, 40) : null, body.phone ? sealText(String(body.phone).slice(0, 40)) : null, effectiveOn],
        )).rows[0];
        const seats = await loadSeats(c, a.propertyId);
        const placed = reassign(seats, {
          positionId: row.id,
          managerId: body.manager_id ? String(body.manager_id) : null,
          effectiveOn,
        }, { allowMultipleGm: settings.allowMultipleGm });
        if (!placed.ok) { reply.code(422); throw Object.assign(new Error(placed.error), { status: 422 }); }
        const after = placed.seats.find(item => item.id === row.id)!;
        const current = seats.find(item => item.id === row.id)!;
        await saveSeat(c, a.propertyId, current, after);
        const summary = `${name || "Vacant"} added as ${title}`;
        await c.query(
          `insert into org_change (tenant_id, property_id, position_id, actor_id, effective_on, kind, summary, before, after)
           values ($1,$2,$3,$4,$5,'create',$6,$7,$8)`,
          [a.tenantId, a.propertyId, row.id, a.userId, effectiveOn, summary, { active: false }, snapshot(after)],
        );
        await audit(c, a, "org_position", row.id, "org.create", { payload: { summary, effective_on: effectiveOn } });
        return { id: row.id, summary };
      });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 422) return reply.code(422).send(problem(422, "validation", (err as Error).message));
      throw err;
    }
  });

  f.post("/v1/org/departments", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "org.manage", reply) || !editor(a, reply)) return;
    const code = String(req.body?.code ?? "").trim().toUpperCase();
    const name = String(req.body?.name ?? "").trim();
    const parentCode = String(req.body?.parent ?? "").trim().toUpperCase();
    if (!CODE.test(code) || name.length < 2) return reply.code(422).send(problem(422, "validation", "A department needs a short code and a name"));
    const parent = parentCode
      ? (await pool.query(`select id from department where property_id=$1 and code=$2`, [a.propertyId, parentCode])).rows[0]
      : null;
    if (parentCode && !parent) return reply.code(422).send(problem(422, "validation", "Choose a department to sit under"));
    if (parentCode === code) return reply.code(422).send(problem(422, "validation", "A department cannot sit under itself"));
    const row = (await pool.query(
      `insert into department (tenant_id, property_id, code, name, parent_id)
       values ($1,$2,$3,$4,$5)
       on conflict (property_id, code) do update set name=excluded.name, parent_id=excluded.parent_id
       returning id`,
      [a.tenantId, a.propertyId, code, name.slice(0, 80), parent?.id ?? null],
    )).rows[0];
    await pool.query(
      `insert into audit_event (tenant_id, property_id, actor_user_id, entity_type, entity_id, action, payload)
       values ($1,$2,$3,'department',$4,'org.department',$5)`,
      [a.tenantId, a.propertyId, a.userId, row.id, { code, name, parent: parentCode || null }],
    );
    return { id: row.id, code, name };
  });

  f.get("/v1/org/settings", async (req, reply) => {
    const a = await requireActor(req, reply, "ADMIN"); if (!a || !allow(a, "org.read", reply)) return;
    const settings = await settingsFor(a.propertyId);
    return { allow_multiple_gm: settings.allowMultipleGm, staff_contact: settings.staffContact };
  });

  f.put("/v1/org/settings", async (req: any, reply) => {
    const a = await requireActor(req, reply, "ADMIN"); if (!a || !allow(a, "org.manage", reply) || !editor(a, reply)) return;
    const next = parseOrgSettings({
      allow_multiple_gm: req.body?.allow_multiple_gm === true,
      staff_contact: req.body?.staff_contact,
    });
    await pool.query(
      `update property set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{org}', $2::jsonb, true) where id=$1`,
      [a.propertyId, JSON.stringify({ allow_multiple_gm: next.allowMultipleGm, staff_contact: next.staffContact })],
    );
    return { allow_multiple_gm: next.allowMultipleGm, staff_contact: next.staffContact };
  });

  f.post("/v1/org/import", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "org.manage", reply) || !editor(a, reply)) return;
    const raw = req.body?.people ? req.body : localImportFile();
    if (!raw) return reply.code(404).send(problem(404, "missing", "No local staff file was found. Add people on this screen, or copy the example import file to the gitignored local file."));
    const parsed = parseOrgImport(raw);
    if (!parsed.ok) return reply.code(422).send(problem(422, "validation", parsed.error));
    const today = await londonToday();
    const result = await tx(async c => {
      const ids = new Map<string, string>();
      for (const person of parsed.people) {
        let dept = (await c.query(`select id from department where property_id=$1 and code=$2`, [a.propertyId, person.department])).rows[0];
        if (!dept) {
          const label = person.department.split(/[_-]/).filter(Boolean).map(word => word.charAt(0) + word.slice(1).toLowerCase()).join(" ");
          dept = (await c.query(
            `insert into department (tenant_id, property_id, code, name) values ($1,$2,$3,$4) returning id`,
            [a.tenantId, a.propertyId, person.department, label || person.department],
          )).rows[0];
        }
        let sectionId: string | null = null;
        if (person.section) {
          const section = (await c.query(
            `insert into department_section (tenant_id, property_id, department_id, code, name)
             values ($1,$2,$3,$4,$5)
             on conflict (department_id, code) do update set name=excluded.name
             returning id`,
            [a.tenantId, a.propertyId, dept.id, person.section, person.section],
          )).rows[0];
          sectionId = section.id;
        }
        const user = (await c.query(
          `insert into app_user (tenant_id, email, display_name) values ($1,$2,$3)
           on conflict (tenant_id, email) do update set display_name=excluded.display_name, status='ACTIVE'
           returning id`,
          [a.tenantId, person.email, person.name],
        )).rows[0];
        const role = person.role ? (await c.query(`select id from role where tenant_id=$1 and code=$2`, [a.tenantId, person.role])).rows[0] : null;
        if (role) {
          const existing = (await c.query(`select id from membership where user_id=$1 and property_id=$2 limit 1`, [user.id, a.propertyId])).rows[0];
          if (!existing) {
            await c.query(
              `insert into membership (tenant_id, user_id, property_id, role_id, department_id, section_id) values ($1,$2,$3,$4,$5,$6)`,
              [a.tenantId, user.id, a.propertyId, role.id, dept.id, sectionId],
            );
          } else if (sectionId) {
            await c.query(`update membership set section_id=$2, department_id=$3 where id=$1`, [existing.id, sectionId, dept.id]);
          }
        }
        const code = positionCode(person.email);
        const seat = (await c.query(
          `insert into org_position (tenant_id, property_id, department_id, section_id, role_id, code, title, level, holder_id, work_phone, personal_phone, example, effective_from)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           on conflict (property_id, code) do update set
             department_id=excluded.department_id, section_id=excluded.section_id, role_id=excluded.role_id,
             title=excluded.title, level=excluded.level, holder_id=excluded.holder_id,
             work_phone=excluded.work_phone, personal_phone=excluded.personal_phone, example=excluded.example, active=true, updated_at=now()
           returning id`,
          [a.tenantId, a.propertyId, dept.id, sectionId, role?.id ?? null, code, person.level === "gm" ? "General manager" : person.name, person.level, user.id, person.workPhone, person.personalPhone ? sealText(person.personalPhone) : null, person.email.endsWith("@example.invalid"), today],
        )).rows[0];
        ids.set(person.email, seat.id);
      }
      for (const person of parsed.people) {
        if (!person.managerEmail) continue;
        const managerId = ids.get(person.managerEmail);
        if (!managerId) continue;
        await c.query(`update org_position set reports_to=$2 where id=$1`, [ids.get(person.email), managerId]);
      }
      const seats = await loadSeats(c, a.propertyId);
      const relevant = seats.filter(seat => [...ids.values()].includes(seat.id));
      if (relevant.length && structureCycle(seats)) {
        reply.code(422);
        throw Object.assign(new Error("That import would make a reporting line go in a circle"), { status: 422 });
      }
      await audit(c, a, "org_position", relevant[0]?.id ?? a.propertyId, "org.import", { payload: { count: parsed.people.length } });
      return { imported: parsed.people.length };
    });
    return result;
  });
}
