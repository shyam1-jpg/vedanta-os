/**
 * House log — shift handover, daily checklists, notices, guest requests.
 * House (ADMIN) and pocket (STAFF) share the same board. Guests never see it.
 */
import type { FastifyInstance } from "fastify";
import { pool } from "./db.ts";
import { requireActor, problem } from "./auth.ts";
import {
  checklistProgress,
  departmentLabel,
  OPS_DEPARTMENTS,
  parseDepartment,
  parseRequestStatus,
  parseShift,
  routeGuestRequest,
  shiftLabel,
} from "../../../domains/ops/board.ts";
import { mayOperate, parseHandoverAudience } from "../../../domains/ops/suite.ts";
import { parseUuid } from "../../../domains/ops/tasks.ts";

async function londonDate(): Promise<string> {
  const r = await pool.query(`select (timezone('Europe/London', now()))::date::text t`);
  return r.rows[0].t;
}

async function requireLogActor(req: any, reply: any) {
  const a = await requireActor(req, reply, ["ADMIN", "STAFF"]);
  if (!a) return null;
  if (a.perms.has("group.read") || a.perms.has("cover.read")) return a;
  reply.code(403).send(problem(403, "forbidden", "You cannot open the house log"));
  return null;
}

function shapeBoard(
  date: string,
  handover: any[],
  notices: any[],
  checks: any[],
  ticks: { item_id: string; done: boolean; done_by_name: string | null }[],
  requests: any[],
) {
  const tickByItem = new Map(ticks.map(t => [t.item_id, t]));
  const checklists = checks.map(item => {
    const tick = tickByItem.get(item.id);
    return {
      id: item.id,
      department: item.department,
      department_label: departmentLabel(item.department),
      title: item.title,
      due_time: item.due_time ?? null,
      done: Boolean(tick?.done),
      done_by_name: tick?.done_by_name ?? null,
    };
  });
  const progress = checklistProgress(checklists);
  return {
    date,
    departments: OPS_DEPARTMENTS,
    progress,
    handover: handover.map(row => ({
      id: row.id,
      department: row.department,
      department_label: departmentLabel(row.department),
      shift: row.shift,
      shift_label: shiftLabel(row.shift),
      for_date: row.for_date,
      body: row.body,
      author_name: row.author_name,
      created_at: row.created_at,
      acknowledged: Boolean(row.acknowledged),
      audience: row.audience ?? "shift",
      recipient_user_id: row.recipient_user_id ?? null,
      recipient_name: row.recipient_name ?? null,
      audience_group: row.audience_group ?? null,
    })),
    notices: notices.map(row => ({
      id: row.id,
      department: row.department,
      department_label: departmentLabel(row.department),
      title: row.title,
      body: row.body,
      author_name: row.author_name,
      pinned: row.pinned,
      created_at: row.created_at,
    })),
    checklists,
    guest_requests: requests.map(row => ({
      id: row.id,
      guest_name: row.guest_name,
      room_label: row.room_label,
      department: row.department,
      department_label: departmentLabel(row.department),
      request_text: row.request_text,
      status: row.status,
      created_at: row.created_at,
    })),
  };
}

async function loadBoard(propertyId: string, date: string, userId: string) {
  const [handover, notices, checks, ticks, requests] = await Promise.all([
    pool.query(
      `select h.id, h.department, h.shift, h.for_date::text, h.body, h.author_name, h.created_at,
        h.audience, h.recipient_user_id, h.audience_group, u.display_name recipient_name,
        exists(select 1 from ops_handover_ack a where a.handover_id=h.id and a.user_id=$3) acknowledged
       from ops_handover h
       left join app_user u on u.id = h.recipient_user_id
       where h.property_id = $1 and h.for_date >= $2::date - 1
       order by h.created_at desc
       limit 40`,
      [propertyId, date, userId],
    ),
    pool.query(
      `select id, department, title, body, author_name, pinned, created_at
       from ops_notice
       where property_id = $1
       order by pinned desc, created_at desc
       limit 20`,
      [propertyId],
    ),
    pool.query(
      `select id, department, title, sort_order, to_char(due_time,'HH24:MI') due_time
       from ops_checklist_item
       where property_id = $1 and active = true
       order by department, sort_order, title`,
      [propertyId],
    ),
    pool.query(
      `select item_id::text, done, done_by_name
       from ops_checklist_tick
       where property_id = $1 and for_date = $2`,
      [propertyId, date],
    ),
    pool.query(
      `select id, guest_name, room_label, department, request_text, status, created_at
       from ops_guest_request
       where property_id = $1 and status <> 'done'
       order by created_at desc
       limit 40`,
      [propertyId],
    ),
  ]);
  return shapeBoard(date, handover.rows, notices.rows, checks.rows, ticks.rows, requests.rows);
}

export default async function ops(f: FastifyInstance) {
  f.post("/v1/ops/handover/:id/acknowledge",async(req:any,reply)=>{
    const a=await requireLogActor(req,reply);if(!a)return;
    const h=(await pool.query(`select id from ops_handover where id=$1 and property_id=$2`,[req.params.id,a.propertyId])).rows[0];
    if(!h)return reply.code(404).send(problem(404,'not_found','Handover not found'));
    await pool.query(`insert into ops_handover_ack(handover_id,user_id) values($1,$2) on conflict do nothing`,[h.id,a.userId]);
    return {ok:true};
  });

  f.get("/v1/ops/board", async (req, reply) => {
    const a = await requireLogActor(req, reply); if (!a) return;
    return loadBoard(a.propertyId, await londonDate(), a.userId);
  });

  f.post("/v1/ops/handover", async (req: any, reply) => {
    const a = await requireLogActor(req, reply); if (!a) return;
    if (!mayOperate(a.perms)) return reply.code(403).send(problem(403, "forbidden", "Only a head of department writes a handover. You can still acknowledge one."));
    const note = String(req.body?.body ?? "").trim();
    if (!note) return reply.code(422).send(problem(422, "validation", "Write the handover note"));
    const department = parseDepartment(req.body?.department, "HOUSE");
    const shift = parseShift(req.body?.shift);
    const audience = parseHandoverAudience(req.body?.audience);
    const recipient = audience === "person" ? parseUuid(req.body?.recipient_user_id) : null;
    const group = audience === "group" ? parseDepartment(req.body?.audience_group, department) : null;
    if (audience === "person" && !recipient) return reply.code(422).send(problem(422, "validation", "Choose the person this note is for"));
    const r = await pool.query(
      `insert into ops_handover (tenant_id, property_id, department, shift, for_date, body, author_user_id, author_name, audience, recipient_user_id, audience_group)
       values ($1, $2, $3, $4, (timezone('Europe/London', now()))::date, $5, $6, $7, $8, $9, $10)
       returning id`,
      [a.tenantId, a.propertyId, department, shift, note, a.userId, a.name, audience, recipient, group],
    );
    return { id: r.rows[0].id };
  });

  f.get("/v1/ops/handovers", async (req: any, reply) => {
    const a = await requireLogActor(req, reply); if (!a) return;
    const department = String(req.query?.department ?? "").trim().toUpperCase();
    const shift = String(req.query?.shift ?? "").trim().toLowerCase();
    const audience = String(req.query?.audience ?? "").trim().toLowerCase();
    const q = String(req.query?.q ?? "").trim();
    const mine = String(req.query?.mine ?? "") === "1";
    const params: unknown[] = [a.propertyId, a.userId];
    const where = ["h.property_id = $1"];
    if (department && department !== "ALL") { params.push(department); where.push(`h.department = $${params.length}`); }
    if (shift === "am" || shift === "pm" || shift === "night") { params.push(shift); where.push(`h.shift = $${params.length}`); }
    if (audience === "shift" || audience === "person" || audience === "group") { params.push(audience); where.push(`h.audience = $${params.length}`); }
    if (mine) where.push(`(h.author_user_id = $2 or h.recipient_user_id = $2 or h.audience_group = (select d.code from membership m join department d on d.id = m.department_id where m.user_id = $2 and m.property_id = $1 limit 1))`);
    if (q) { params.push(`%${q.replace(/[%_]/g, "")}%`); where.push(`(h.body ilike $${params.length} or h.author_name ilike $${params.length})`); }
    const rows = (await pool.query(
      `select h.id, h.department, h.shift, h.for_date::text, h.body, h.author_name, h.created_at,
              h.audience, h.recipient_user_id, h.audience_group, u.display_name recipient_name,
              exists(select 1 from ops_handover_ack a where a.handover_id=h.id and a.user_id=$2) acknowledged
       from ops_handover h
       left join app_user u on u.id = h.recipient_user_id
       where ${where.join(" and ")}
       order by h.created_at desc
       limit 80`,
      params,
    )).rows;
    return { items: rows.map(row => ({
      ...row,
      department_label: departmentLabel(row.department),
      shift_label: shiftLabel(row.shift),
      acknowledged: Boolean(row.acknowledged),
    })) };
  });

  f.post("/v1/ops/notices", async (req: any, reply) => {
    const a = await requireLogActor(req, reply); if (!a) return;
    const title = String(req.body?.title ?? "").trim();
    const body = String(req.body?.body ?? "").trim();
    if (!title || !body) return reply.code(422).send(problem(422, "validation", "Title and note are required"));
    const department = req.body?.department ? parseDepartment(req.body.department, "HOUSE") : null;
    const r = await pool.query(
      `insert into ops_notice (tenant_id, property_id, department, title, body, author_user_id, author_name, pinned)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id`,
      [a.tenantId, a.propertyId, department, title, body, a.userId, a.name, Boolean(req.body?.pinned)],
    );
    return { id: r.rows[0].id };
  });

  f.post("/v1/ops/checklists/:id/tick", async (req: any, reply) => {
    const a = await requireLogActor(req, reply); if (!a) return;
    const done = req.body?.done !== false;
    const owned = (await pool.query(
      `select id from ops_checklist_item where id=$1 and property_id=$2`,
      [req.params.id, a.propertyId],
    )).rows[0];
    if (!owned) return reply.code(404).send(problem(404, "not_found", "No such checklist item"));
    await pool.query(
      `insert into ops_checklist_tick (tenant_id, property_id, item_id, for_date, done, done_by_user_id, done_by_name, done_at)
       values ($1, $2, $3, (timezone('Europe/London', now()))::date, $4, $5, $6, now())
       on conflict (item_id, for_date) do update
         set done = excluded.done,
             done_by_user_id = excluded.done_by_user_id,
             done_by_name = excluded.done_by_name,
             done_at = now()`,
      [a.tenantId, a.propertyId, req.params.id, done, a.userId, a.name],
    );
    return { ok: true, done };
  });

  f.get("/v1/ops/guest-requests", async (req: any, reply) => {
    const a = await requireLogActor(req, reply); if (!a) return;
    const status = String(req.query?.status ?? "").trim().toLowerCase();
    const department = String(req.query?.department ?? "").trim().toUpperCase();
    const q = String(req.query?.q ?? "").trim();
    const params: unknown[] = [a.propertyId];
    const where = ["property_id = $1"];
    if (status === "open" || status === "doing" || status === "done") { params.push(status); where.push(`status = $${params.length}`); }
    if (department && department !== "ALL") { params.push(department); where.push(`department = $${params.length}`); }
    if (q) { params.push(`%${q.replace(/[%_]/g, "")}%`); where.push(`(request_text ilike $${params.length} or guest_name ilike $${params.length} or room_label ilike $${params.length})`); }
    const rows = (await pool.query(
      `select id, guest_name, room_label, department, request_text, status, created_at
       from ops_guest_request where ${where.join(" and ")} order by created_at desc limit 200`,
      params,
    )).rows;
    return { items: rows.map(row => ({ ...row, department_label: departmentLabel(row.department) })) };
  });

  f.post("/v1/ops/guest-requests", async (req: any, reply) => {
    const a = await requireLogActor(req, reply); if (!a) return;
    const requestText = String(req.body?.request_text ?? req.body?.requestText ?? "").trim();
    if (!requestText) return reply.code(422).send(problem(422, "validation", "Write what is needed"));
    const department = routeGuestRequest(requestText, req.body?.department);
    const r = await pool.query(
      `insert into ops_guest_request (
         tenant_id, property_id, guest_enquiry_id, guest_name, room_label, department, request_text, status
       ) values ($1, $2, $3, $4, $5, $6, $7, 'open')
       returning id, department`,
      [
        a.tenantId,
        a.propertyId,
        String(req.body?.guest_enquiry_id ?? "").trim() || null,
        String(req.body?.guest_name ?? "").trim() || null,
        String(req.body?.room_label ?? "").trim() || null,
        department,
        requestText,
      ],
    );
    return { id: r.rows[0].id, department: r.rows[0].department, department_label: departmentLabel(r.rows[0].department) };
  });

  f.patch("/v1/ops/guest-requests/:id", async (req: any, reply) => {
    const a = await requireLogActor(req, reply); if (!a) return;
    const status = parseRequestStatus(req.body?.status);
    const r = await pool.query(
      `update ops_guest_request
          set status = $3, updated_at = now()
        where property_id = $1 and id = $2
        returning id`,
      [a.propertyId, req.params.id, status],
    );
    if (!r.rowCount) return reply.code(404).send(problem(404, "not_found", "No such request"));
    return { ok: true, status };
  });
}
