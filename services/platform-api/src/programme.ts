/**
 * Programme Operating Sheet
 * One programme record auto-generates work items for every department:
 * kitchen, housekeeping, halls, transport, staffing, maintenance.
 * Triggered automatically when a booking is confirmed.
 */
import type { FastifyInstance } from "fastify";
import { pool, tx } from "./db.ts";
import { requireActor, allow, problem } from "./auth.ts";
import { audit } from "./groups.ts";

// Department work rules — what each dept needs to do per programme item kind
const DEPT_RULES: Record<string, { dept: string; title: (item: any) => string; desc?: (item: any) => string }[]> = {
  meal: [
    { dept: "kitchen", title: i => `Prepare ${i.title}`, desc: i => `${i.covers ?? "?"} covers${i.notes ? " · " + i.notes : ""}` },
    { dept: "halls",   title: i => `Set ${i.location ?? "dining room"} for ${i.title}`, desc: i => `${i.covers ?? "?"} covers` },
  ],
  session: [
    { dept: "halls",   title: i => `Prepare ${i.location ?? "hall"} for ${i.title}`, desc: i => i.teacher ? `Teacher: ${i.teacher}` : undefined },
  ],
  activity: [
    { dept: "halls",   title: i => `Set up for ${i.title}`, desc: i => i.location ? `Location: ${i.location}` : undefined },
  ],
  transfer: [
    { dept: "transport", title: i => `Transport: ${i.title}`, desc: i => i.notes ?? undefined },
  ],
  ceremony: [
    { dept: "halls",   title: i => `Prepare for ${i.title}`, desc: i => i.location ? `Location: ${i.location}` : undefined },
    { dept: "kitchen", title: i => `Prasad / refreshments for ${i.title}` },
  ],
};

export async function generateDeptWork(programmeId: string, tenantId: string, propertyId: string) {
  const items = (await pool.query(
    `SELECT pi.*, p.arrival FROM programme_item pi JOIN programme p ON p.id = pi.programme_id WHERE pi.programme_id = $1`,
    [programmeId]
  )).rows;

  const toInsert: any[] = [];
  for (const item of items) {
    const workDate = new Date(item.arrival);
    workDate.setDate(workDate.getDate() + item.day_offset);
    const dateStr = workDate.toISOString().slice(0, 10);

    // Custom departments override
    const depts = item.departments?.length ? item.departments : [];
    const rules = DEPT_RULES[item.kind] ?? [];

    for (const rule of rules) {
      toInsert.push({
        tenantId, propertyId, programmeId, itemId: item.id,
        dept: rule.dept, date: dateStr, time: item.start_time,
        title: rule.title(item), desc: rule.desc?.(item) ?? null,
      });
    }
    // Additional custom depts
    for (const dept of depts) {
      if (!rules.find(r => r.dept === dept)) {
        toInsert.push({
          tenantId, propertyId, programmeId, itemId: item.id,
          dept, date: dateStr, time: item.start_time,
          title: item.title, desc: item.notes ?? null,
        });
      }
    }
  }

  if (toInsert.length > 0) {
    // Clear existing auto-generated items first
    await pool.query(`DELETE FROM dept_work_item WHERE programme_id = $1`, [programmeId]);
    for (const w of toInsert) {
      await pool.query(
        `INSERT INTO dept_work_item (tenant_id, property_id, programme_id, programme_item_id, department, work_date, work_time, title, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [w.tenantId, w.propertyId, w.programmeId, w.itemId, w.dept, w.date, w.time, w.title, w.desc]
      );
    }
  }
  return toInsert.length;
}

export default async function programme(f: FastifyInstance) {

  // List programmes for property
  f.get("/v1/programmes", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.read", reply)) return;
    const r = await pool.query(
      `SELECT p.id, p.name, p.lead_teacher, p.style, p.arrival::text, p.departure::text,
              p.guests, p.status, p.notes, g.name AS group_name, g.status AS group_status
       FROM programme p LEFT JOIN booking_group g ON g.id = p.group_id
       WHERE p.property_id = $1 ORDER BY p.arrival DESC`,
      [a.propertyId]);
    return { items: r.rows };
  });

  // Get one programme with full schedule
  f.get<{ Params: { id: string } }>("/v1/programmes/:id", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.read", reply)) return;
    const p = (await pool.query(
      `SELECT p.*, g.name AS group_name, g.expected_guests, g.arrival_date::text AS group_arrival
       FROM programme p LEFT JOIN booking_group g ON g.id = p.group_id
       WHERE p.id = $1 AND p.property_id = $2`, [req.params.id, a.propertyId]
    )).rows[0];
    if (!p) return reply.code(404).send(problem(404, "not_found", "Programme not found"));
    const items = (await pool.query(
      `SELECT * FROM programme_item WHERE programme_id = $1 ORDER BY day_offset, start_time`,
      [req.params.id]
    )).rows;
    const deptWork = (await pool.query(
      `SELECT dw.*, u.display_name AS assignee_name FROM dept_work_item dw
       LEFT JOIN app_user u ON u.id = dw.assigned_to
       WHERE dw.programme_id = $1 ORDER BY dw.work_date, dw.work_time`,
      [req.params.id]
    )).rows;
    return { ...p, items, dept_work: deptWork };
  });

  // Create programme (auto-linked to a booking)
  f.post("/v1/programmes", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.update", reply)) return;
    const { group_id, name, lead_teacher, style, arrival, departure, guests, notes } = req.body ?? {};
    if (!name || !arrival || !departure) return reply.code(422).send(problem(422, "validation", "name, arrival and departure are required"));
    const p = (await pool.query(
      `INSERT INTO programme (tenant_id, property_id, group_id, name, lead_teacher, style, arrival, departure, guests, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [a.tenantId, a.propertyId, group_id ?? null, name, lead_teacher ?? null, style ?? null, arrival, departure, guests ?? null, notes ?? null, a.userId]
    )).rows[0];
    return { id: p.id };
  });

  // Add a schedule item
  f.post<{ Params: { id: string } }>("/v1/programmes/:id/items", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.update", reply)) return;
    const { day_offset, start_time, end_time, kind, title, location, teacher, covers, notes, departments } = req.body ?? {};
    if (!start_time || !kind || !title) return reply.code(422).send(problem(422, "validation", "start_time, kind and title are required"));
    const item = (await pool.query(
      `INSERT INTO programme_item (tenant_id, programme_id, day_offset, start_time, end_time, kind, title, location, teacher, covers, notes, departments)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [a.tenantId, req.params.id, day_offset ?? 0, start_time, end_time ?? null, kind, title, location ?? null, teacher ?? null, covers ?? null, notes ?? null, departments ?? []]
    )).rows[0];
    // Regenerate dept work
    await generateDeptWork(req.params.id, a.tenantId, a.propertyId);
    return { id: item.id };
  });

  // Delete a schedule item
  f.delete<{ Params: { id: string; itemId: string } }>("/v1/programmes/:id/items/:itemId", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.update", reply)) return;
    await pool.query(`DELETE FROM programme_item WHERE id=$1 AND programme_id=$2`, [req.params.itemId, req.params.id]);
    await generateDeptWork(req.params.id, a.tenantId, a.propertyId);
    return { ok: true };
  });

  // Regenerate all dept work items
  f.post<{ Params: { id: string } }>("/v1/programmes/:id/generate", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.update", reply)) return;
    const count = await generateDeptWork(req.params.id, a.tenantId, a.propertyId);
    return { generated: count };
  });

  // Get dept work for a specific department and date range
  f.get("/v1/dept-work", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.read", reply)) return;
    const { department, from, to } = req.query ?? {};
    const r = await pool.query(
      `SELECT dw.id, dw.department, dw.work_date::text, dw.work_time::text, dw.title, dw.description,
              dw.status, dw.done_at, p.name AS programme_name, u.display_name AS assignee_name
       FROM dept_work_item dw
       LEFT JOIN programme p ON p.id = dw.programme_id
       LEFT JOIN app_user u ON u.id = dw.assigned_to
       WHERE dw.property_id = $1
         AND ($2::text IS NULL OR dw.department = $2)
         AND ($3::date IS NULL OR dw.work_date >= $3::date)
         AND ($4::date IS NULL OR dw.work_date <= $4::date)
       ORDER BY dw.work_date, dw.work_time`,
      [a.propertyId, department ?? null, from ?? null, to ?? null]
    );
    return { items: r.rows };
  });

  // Update dept work item status
  f.patch<{ Params: { id: string } }>("/v1/dept-work/:id", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const { status, assigned_to } = req.body ?? {};
    await pool.query(
      `UPDATE dept_work_item SET
         status = coalesce($2, status),
         assigned_to = coalesce($3::uuid, assigned_to),
         done_at = CASE WHEN $2 = 'done' THEN now() ELSE done_at END,
         done_by = CASE WHEN $2 = 'done' THEN $4::uuid ELSE done_by END
       WHERE id = $1 AND property_id = $5`,
      [req.params.id, status ?? null, assigned_to ?? null, a.userId, a.propertyId]
    );
    return { ok: true };
  });

  // Get programme sheet for a booking (summary for kitchen/dept briefing)
  f.get<{ Params: { groupId: string } }>("/v1/groups/:groupId/programme", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.read", reply)) return;
    const p = (await pool.query(
      `SELECT p.id, p.name, p.lead_teacher, p.style, p.arrival::text, p.departure::text, p.guests, p.dietary_summary, p.status
       FROM programme p WHERE p.group_id = $1 AND p.property_id = $2`,
      [req.params.groupId, a.propertyId]
    )).rows[0];
    if (!p) return reply.code(404).send(problem(404, "not_found", "No programme sheet for this booking"));
    const items = (await pool.query(
      `SELECT day_offset, start_time::text, end_time::text, kind, title, location, teacher, covers, notes, departments
       FROM programme_item WHERE programme_id = $1 ORDER BY day_offset, start_time`,
      [p.id]
    )).rows;
    // Group by day
    const days: Record<number, typeof items> = {};
    for (const item of items) {
      if (!days[item.day_offset]) days[item.day_offset] = [];
      days[item.day_offset].push(item);
    }
    return { ...p, days };
  });
}
