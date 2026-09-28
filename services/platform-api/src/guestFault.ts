/** Guest "report a problem" opens a maintenance ticket and reuses its notices. */
import type { FastifyInstance } from "fastify";
import { pool, tx } from "./db.ts";
import { problem } from "./auth.ts";
import { sendEmail } from "./email.ts";
import { openStayLink } from "./journey.ts";
import { cleanPhoto, parseFaultRouting, reportNotices, type FaultRouting, type FaultView } from "../../../domains/ops/fault.ts";
import {
  followUpCopy,
  GUEST_CATEGORIES,
  guestFaultDraft,
  guestStatus,
  screenGuestReport,
  urgentPing,
} from "../../../domains/ops/guestFault.ts";

async function routing(propertyId: string): Promise<FaultRouting> {
  const row = (await pool.query(`select settings from property where id=$1`, [propertyId])).rows[0];
  return parseFaultRouting(row?.settings?.fault_routing);
}

async function onShift(propertyId: string): Promise<string[]> {
  try {
    const rows = (await pool.query(
      `select distinct u.email from rota_shift s join app_user u on u.id=s.user_id
       where s.property_id=$1 and s.shift_date = timezone('Europe/London', now())::date and s.status <> 'cancelled' and u.email is not null`,
      [propertyId],
    )).rows as { email: string }[];
    return rows.map(row => row.email);
  } catch {
    return [];
  }
}

export async function guestReports(propertyId: string, personId: string) {
  const rows = (await pool.query(
    `select g.id, g.category, g.room, t.status, g.follow_up
     from guest_report g join maintenance_ticket t on t.id=g.ticket_id
     where g.property_id=$1 and g.person_id=$2 order by g.created_at desc limit 20`,
    [propertyId, personId],
  )).rows as { id: string; category: string; room: string; status: string; follow_up: string | null }[];
  return rows.map(row => ({
    id: row.id,
    category: row.category,
    room: row.room,
    status: guestStatus(row.status),
    ask: guestStatus(row.status) === "fixed" && !row.follow_up,
  }));
}

export async function notifyGuestFollowUp(ticketId: string) {
  const row = (await pool.query(
    `select g.id, g.tenant_id, g.property_id, g.group_id, g.follow_up_sent_at, p.email, t.number, t.status, t.location
     from guest_report g
     join maintenance_ticket t on t.id=g.ticket_id
     join person p on p.id=g.person_id
     where g.ticket_id=$1`,
    [ticketId],
  )).rows[0];
  if (!row || row.follow_up_sent_at || row.status !== "DONE") return;
  const email = String(row.email ?? "").trim().toLowerCase();
  if (!email.includes("@")) return;
  await sendEmail(
    { tenantId: row.tenant_id, propertyId: row.property_id },
    { to: email, subject: `Was M-${row.number} sorted?`, body: followUpCopy(), kind: "guest_report_follow_up", related_type: "maintenance_ticket", related_id: ticketId },
  );
  await pool.query(`update guest_report set follow_up_sent_at=now() where id=$1`, [row.id]);
}

export default async function guestFaultRoutes(f: FastifyInstance) {
  f.post<{ Params: { token: string } }>("/public/journey/:token/problem", async (req: any, reply) => {
    const found = await openStayLink(req.params.token);
    if (!found.ok) return reply.code(found.status).send(problem(found.status, "not_found", found.error));
    const check = (await pool.query(
      `select status from guest_check_in where group_id=$1 and person_id=$2`,
      [found.row.group_id, found.row.person_id],
    )).rows[0];
    if (!check || !["checked_in_digitally", "arrived", "keys_issued"].includes(check.status)) {
      return reply.code(422).send(problem(422, "validation", "Check in before reporting a problem"));
    }
    const roomRow = (await pool.query(
      `select r.number from room_occupancy o join room r on r.id=o.room_id where o.group_id=$1 and o.person_id=$2 order by o.on_date limit 1`,
      [found.row.group_id, found.row.person_id],
    )).rows[0];
    const room = String(roomRow?.number ?? "");
    const recentRows = (await pool.query(
      `select description, extract(epoch from created_at)*1000 as at from guest_report where person_id=$1 and created_at > now() - interval '1 hour'`,
      [found.row.person_id],
    )).rows as { description: string; at: number }[];
    const screened = screenGuestReport({
      description: String(req.body?.description ?? ""),
      room,
      category: String(req.body?.category ?? ""),
      enter: req.body?.enter === true ? true : req.body?.enter === false ? false : null,
      recent: recentRows.map(row => ({ at: Number(row.at), text: row.description })),
      now: Date.now(),
    });
    if (!screened.ok) return reply.code(422).send(problem(422, "validation", screened.error));
    const photo = cleanPhoto(req.body?.photo);
    if (!photo.ok) return reply.code(422).send(problem(422, "validation", photo.error));
    const draft = guestFaultDraft({
      category: String(req.body.category),
      urgency: req.body?.urgency === "urgent" ? "urgent" : "wait",
      description: screened.description,
      room,
      enter: req.body.enter === true,
    });
    const saved = await tx(async c => {
      const place = (await c.query(`select id from room where property_id=$1 and number=$2`, [found.row.property_id, room])).rows[0];
      const ticket = (await c.query(
        `insert into maintenance_ticket (tenant_id, property_id, room_id, location, department, title, description, priority, equipment_label, equipment_category, photo, food_safety)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id, number`,
        [found.row.tenant_id, found.row.property_id, place?.id ?? null, room, draft.department, draft.title, draft.description, draft.priority, draft.equipmentLabel, draft.equipmentCategory, photo.photo, draft.foodSafety],
      )).rows[0];
      const report = (await c.query(
        `insert into guest_report (tenant_id, property_id, group_id, person_id, ticket_id, category, urgency, enter_ok, room, description)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [found.row.tenant_id, found.row.property_id, found.row.group_id, found.row.person_id, ticket.id, req.body.category, req.body?.urgency === "urgent" ? "urgent" : "wait", req.body.enter === true, room, screened.description],
      )).rows[0];
      await c.query(
        `insert into audit_event(tenant_id, property_id, actor_user_id, entity_type, entity_id, action, payload)
         values ($1,$2,null,'maintenance_ticket',$3,'guest.report',$4)`,
        [found.row.tenant_id, found.row.property_id, ticket.id, { category: req.body.category, room, priority: draft.priority }],
      );
      return { id: report.id as string, ticketId: ticket.id as string, number: ticket.number as number };
    });
    const view: FaultView = {
      number: saved.number,
      description: draft.description,
      location: `Room ${room}`,
      equipment: draft.equipmentLabel,
      urgency: draft.priority,
      reporter: found.row.given_name || "Guest",
      foodSafety: draft.foodSafety,
      photo: !!photo.photo,
    };
    const rules = await routing(found.row.property_id);
    const notes = reportNotices(view, rules);
    if (draft.pingOnShift) notes.push(...urgentPing(view, await onShift(found.row.property_id)));
    for (const note of notes) {
      if (!note.to.includes("@")) continue;
      await sendEmail(
        { tenantId: found.row.tenant_id, propertyId: found.row.property_id },
        { to: note.to, subject: note.subject, body: note.body, kind: `fault_${note.audience}`, related_type: "maintenance_ticket", related_id: saved.ticketId },
      );
    }
    return { ok: true, id: saved.id, number: saved.number, status: "received" };
  });

  f.post<{ Params: { token: string; id: string } }>("/public/journey/:token/problem/:id", async (req: any, reply) => {
    const found = await openStayLink(req.params.token);
    if (!found.ok) return reply.code(found.status).send(problem(found.status, "not_found", found.error));
    const answer = req.body?.sorted === true ? "yes" : req.body?.sorted === false ? "no" : "";
    if (!answer) return reply.code(422).send(problem(422, "validation", "Say whether it was sorted"));
    const saved = await pool.query(
      `update guest_report set follow_up=$3 where id=$1 and person_id=$2 and follow_up is null`,
      [req.params.id, found.row.person_id, answer],
    );
    if (!saved.rowCount) return reply.code(404).send(problem(404, "not_found", "That report is not on your stay"));
    return { ok: true };
  });
}

export { GUEST_CATEGORIES };
