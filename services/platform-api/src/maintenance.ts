import type { FastifyInstance } from "fastify";
import { pool, tx } from "./db.ts";
import { requireActor, allow, problem } from "./auth.ts";
import { audit } from "./groups.ts";
import { sendEmail } from "./email.ts";
import {
  EQUIPMENT_CATEGORIES,
  URGENCIES,
  isFoodSafetyEquipment,
  nextFaultStatus,
  parseAreas,
  parseFaultRouting,
  reportNotices,
  statusNotices,
  statusWords,
  urgencyLabel,
  validateFault,
  type FaultNotice,
  type FaultRouting,
  type FaultView,
} from "../../../domains/ops/fault.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuidOrNull(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return UUID_RE.test(s) ? s : null;
}

const COLS = `t.id, t.number, t.title, t.description, t.priority, t.status, t.location, t.department, t.takes_room_out, t.resolution, t.created_at, t.updated_at, t.resolved_at, t.version,
  t.room_id, t.asset_id, t.equipment_label, t.equipment_category, t.food_safety, (t.photo is not null) as has_photo,
  r.number room, rep.display_name reported_by, rep.email reporter_email, asg.display_name assigned_to, t.assigned_to_user_id, t.reported_by_user_id,
  ast.name asset_name, ast.category asset_category, ast.qr_code asset_code`;
const FROM = `from maintenance_ticket t
  left join room r on r.id=t.room_id
  left join app_user rep on rep.id=t.reported_by_user_id
  left join app_user asg on asg.id=t.assigned_to_user_id
  left join asset ast on ast.id=t.asset_id`;

async function house(req: any, reply: any) {
  return requireActor(req, reply, ["ADMIN", "STAFF"]);
}

async function loadRouting(propertyId: string): Promise<FaultRouting> {
  const row = (await pool.query(`select settings from property where id=$1`, [propertyId])).rows[0];
  return parseFaultRouting(row?.settings?.fault_routing);
}

async function loadAreas(propertyId: string): Promise<string[]> {
  const row = (await pool.query(`select settings from property where id=$1`, [propertyId])).rows[0];
  return parseAreas(row?.settings?.fault_areas);
}

function viewOf(row: any): FaultView {
  const equipment = [row.asset_name, row.equipment_label, row.equipment_category].filter(Boolean).join(" · ") || null;
  return {
    number: row.number,
    description: row.description || row.title,
    location: row.room ? `Room ${row.room}` : (row.location || "the house"),
    equipment,
    urgency: row.priority,
    reporter: row.reported_by || "Staff",
    foodSafety: !!row.food_safety,
    photo: !!row.has_photo,
  };
}

async function deliver(a: { tenantId: string; propertyId: string; userId?: string | null }, notes: FaultNotice[], ticketId: string) {
  for (const note of notes) {
    if (!note.to.includes("@")) continue;
    await sendEmail(a, { to: note.to, subject: note.subject, body: note.body, kind: `fault_${note.audience}`, related_type: "maintenance_ticket", related_id: ticketId });
  }
}

export default async function routes(f: FastifyInstance) {
  f.get("/settings/fault-routing", async (req, reply) => {
    const a = await house(req, reply); if (!a) return;
    if (!a.perms.has("package.manage") && !a.perms.has("config.manage") && !a.perms.has("maintenance.work")) {
      return reply.code(403).send(problem(403, "forbidden", "You cannot open fault settings"));
    }
    const row = (await pool.query(`select settings from property where id=$1`, [a.propertyId])).rows[0];
    return {
      areas: parseAreas(row?.settings?.fault_areas),
      emails: parseFaultRouting(row?.settings?.fault_routing),
      receives: {
        maintenance: "Every fault, with the place, the equipment, the words the reporter used, and how urgent it is.",
        manager: "The general manager is copied on every report and on each status change.",
        kitchen: "Only when the equipment is a fridge, freezer or other cold store.",
      },
    };
  });

  f.put("/settings/fault-routing", async (req: any, reply) => {
    const a = await house(req, reply); if (!a || !allow(a, "package.manage", reply)) return;
    const areas = parseAreas(req.body?.areas);
    const emails = parseFaultRouting(req.body?.emails ?? req.body);
    await pool.query(
      `update property set settings = jsonb_set(jsonb_set(coalesce(settings, '{}'::jsonb), '{fault_areas}', $2::jsonb, true), '{fault_routing}', $3::jsonb, true) where id=$1`,
      [a.propertyId, JSON.stringify(areas), JSON.stringify(emails)],
    );
    return { areas, emails };
  });

  f.get("/maintenance/catalogue", async (req, reply) => {
    const a = await house(req, reply); if (!a || !allow(a, "maintenance.report", reply)) return;
    const rooms = await pool.query(`select number from room where property_id=$1 order by number`, [a.propertyId]);
    const assets = await pool.query(
      `select id, name, category, qr_code from asset where property_id=$1 and status <> 'disposed' order by name`,
      [a.propertyId],
    );
    return {
      rooms: rooms.rows.map((r: { number: string }) => r.number),
      areas: await loadAreas(a.propertyId),
      assets: assets.rows,
      categories: EQUIPMENT_CATEGORIES,
      urgencies: URGENCIES,
      reporter: a.name,
    };
  });

  f.get<{ Querystring: { status?: string; room?: string; area?: string; asset?: string; equipment?: string; mine?: string } }>("/maintenance", async (req, reply) => {
    const a = await house(req, reply); if (!a) return;
    const mine = req.query.mine === "1";
    if (req.query.asset && !uuidOrNull(req.query.asset)) return reply.code(422).send(problem(422, "validation", "That equipment is not on the register"));
    if (mine) {
      if (!a.perms.has("maintenance.report") && !a.perms.has("maintenance.read")) return allow(a, "maintenance.report", reply);
    } else if (!allow(a, "maintenance.read", reply)) return;
    const status = String(req.query.status ?? "open");
    const one = ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "WAITING_PARTS", "DONE", "CANCELLED"].includes(status) ? status : null;
    const r = await pool.query(
      `select ${COLS} ${FROM}
       where t.property_id=$1
         and ($2::uuid is null or t.reported_by_user_id=$2)
         and (
           ($3 = 'all')
           or ($3 = 'closed' and t.status in ('DONE','CANCELLED'))
           or ($3 = 'open' and t.status not in ('DONE','CANCELLED'))
           or ($4::text is not null and t.status=$4)
         )
         and ($5::text is null or r.number=$5)
         and ($6::text is null or t.location=$6)
         and ($7::uuid is null or t.asset_id=$7)
         and ($8::text is null or t.equipment_label ilike '%' || $8 || '%' or ast.name ilike '%' || $8 || '%' or t.equipment_category ilike '%' || $8 || '%')
       order by case t.priority when 'SAFETY' then 0 when 'URGENT' then 1 when 'NORMAL' then 2 else 3 end, t.created_at desc
       limit 200`,
      [
        a.propertyId,
        mine ? a.userId : null,
        one ? "one" : (status === "closed" || status === "all" ? status : "open"),
        one,
        req.query.room || null,
        req.query.area || null,
        req.query.asset ? uuidOrNull(req.query.asset) : null,
        req.query.equipment?.trim() || null,
      ],
    );
    const people = await pool.query(`select u.id, u.display_name name from app_user u join membership m on m.user_id=u.id join role ro on ro.id=m.role_id where u.tenant_id=$1 and u.status='ACTIVE' and ro.code in ('MAINTENANCE','GROUNDS','HK_SUPERVISOR','GENERAL_MANAGER') order by 2`, [a.tenantId]);
    const ids = r.rows.map((row: { id: string }) => row.id);
    const notes = ids.length
      ? await pool.query(
        `select n.ticket_id, n.body, n.created_at, u.display_name author from maintenance_note n left join app_user u on u.id=n.author_user_id where n.ticket_id = any($1::uuid[]) order by n.created_at`,
        [ids],
      )
      : { rows: [] };
    const repeats = ids.length
      ? await pool.query(
        `select t.id,
           (select count(*)::int from maintenance_ticket o where o.property_id=t.property_id and o.room_id=t.room_id and t.room_id is not null and o.id<>t.id) earlier_room,
           (select count(*)::int from maintenance_ticket o where o.property_id=t.property_id and o.asset_id=t.asset_id and t.asset_id is not null and o.id<>t.id) earlier_asset
         from maintenance_ticket t where t.id = any($1::uuid[])`,
        [ids],
      )
      : { rows: [] };
    return {
      items: r.rows.map((row: any) => {
        const repeat = repeats.rows.find((n: { id: string }) => n.id === row.id);
        return {
          ...row,
          urgency_label: urgencyLabel(row.priority),
          status_label: statusWords(row.status),
          notes: notes.rows.filter((n: { ticket_id: string }) => n.ticket_id === row.id),
          earlier_room: repeat?.earlier_room ?? 0,
          earlier_asset: repeat?.earlier_asset ?? 0,
        };
      }),
      assignees: people.rows,
    };
  });

  f.get<{ Params: { id: string } }>("/maintenance/:id", async (req, reply) => {
    const a = await house(req, reply); if (!a) return;
    const row = (await pool.query(`select ${COLS}, t.photo ${FROM} where t.id=$1 and t.property_id=$2`, [req.params.id, a.propertyId])).rows[0];
    if (!row) return reply.code(404).send(problem(404, "not_found", "No such ticket"));
    if (row.reported_by_user_id !== a.userId && !a.perms.has("maintenance.read")) return allow(a, "maintenance.read", reply);
    const notes = await pool.query(
      `select n.body, n.created_at, u.display_name author from maintenance_note n left join app_user u on u.id=n.author_user_id where n.ticket_id=$1 order by n.created_at`,
      [row.id],
    );
    const history = await pool.query(
      `select t.id, t.number, t.title, t.status, t.created_at from maintenance_ticket t
       where t.property_id=$1 and t.id<>$2 and (($3::uuid is not null and t.room_id=$3) or ($4::uuid is not null and t.asset_id=$4))
       order by t.created_at desc limit 20`,
      [a.propertyId, row.id, row.room_id, row.asset_id],
    );
    return { ...row, notes: notes.rows, history: history.rows, urgency_label: urgencyLabel(row.priority), status_label: statusWords(row.status) };
  });

  f.post("/maintenance", async (req: any, reply) => {
    const a = await house(req, reply); if (!a || !allow(a, "maintenance.report", reply)) return;
    const b = req.body ?? {};
    let assetName: string | null = null;
    let assetCategory: string | null = null;
    if (b.asset_id) {
      const assetId = uuidOrNull(b.asset_id);
      if (!assetId) return reply.code(422).send(problem(422, "validation", "That equipment is not on the register"));
      b.asset_id = assetId;
      const asset = (await pool.query(`select name, category from asset where id=$1 and property_id=$2 and status <> 'disposed'`, [assetId, a.propertyId])).rows[0];
      if (!asset) return reply.code(404).send(problem(404, "not_found", "That equipment is not on the register"));
      assetName = asset.name;
      assetCategory = asset.category;
    }
    const parsed = validateFault({ ...b, assetName, assetCategory, reporterDepartment: a.department });
    if (!parsed.ok) return reply.code(422).send(problem(422, "validation", parsed.error));
    const draft = parsed.draft;
    if (!draft.foodSafety && assetName) draft.foodSafety = isFoodSafetyEquipment({ name: assetName, category: assetCategory, label: draft.equipmentLabel });
    const saved = await tx(async c => {
      const room = draft.room ? (await c.query(`select id, status from room where property_id=$1 and number=$2 for update`, [a.propertyId, draft.room])).rows[0] : null;
      if (draft.room && !room) { reply.code(404); return problem(404, "not_found", `No room ${draft.room}`); }
      const location = draft.room ? (draft.area || null) : draft.area;
      const r = await c.query(
        `insert into maintenance_ticket (tenant_id, property_id, room_id, location, department, title, description, priority, reported_by_user_id, takes_room_out, asset_id, equipment_label, equipment_category, photo, food_safety)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id, number`,
        [a.tenantId, a.propertyId, room?.id ?? null, location, draft.department, draft.title, draft.description, draft.priority, a.userId, draft.takesRoomOut, draft.assetId, draft.equipmentLabel || assetName, draft.equipmentCategory, draft.photo, draft.foodSafety || isFoodSafetyEquipment({ name: assetName, category: assetCategory, label: draft.equipmentLabel })],
      );
      if (draft.takesRoomOut && room && !["OUT_OF_SERVICE", "OUT_OF_ORDER"].includes(room.status)) {
        await c.query(`update room set status='OUT_OF_ORDER', status_before_oos=$2, version=version+1 where id=$1`, [room.id, room.status]);
        await c.query(`insert into room_status_event (tenant_id, room_id, from_status, to_status, by_user_id, reason) values ($1,$2,$3,'OUT_OF_ORDER',$4,$5)`, [a.tenantId, room.id, room.status, a.userId, `M-${r.rows[0].number}: ${draft.title}`]);
      }
      await audit(c, a, "maintenance_ticket", r.rows[0].id, "maintenance.report", { payload: { title: draft.title, room: draft.room, area: draft.area, priority: draft.priority, food_safety: draft.foodSafety } });
      return { id: r.rows[0].id as string, number: r.rows[0].number as number, draft, assetName };
    });
    if (!saved || !("id" in saved)) return saved;
    const rules = await loadRouting(a.propertyId);
    const view: FaultView = {
      number: saved.number,
      description: saved.draft.description || saved.draft.title,
      location: saved.draft.room ? `Room ${saved.draft.room}` : (saved.draft.area || "the house"),
      equipment: saved.draft.equipmentLabel || saved.assetName,
      urgency: saved.draft.priority,
      reporter: a.name,
      foodSafety: saved.draft.foodSafety,
      photo: !!saved.draft.photo,
    };
    await deliver(a, reportNotices(view, rules), saved.id);
    reply.code(201);
    return { id: saved.id, number: saved.number, food_safety: saved.draft.foodSafety };
  });

  f.post<{ Params: { id: string }; Body: { body?: string } }>("/maintenance/:id/notes", async (req, reply) => {
    const a = await house(req, reply); if (!a) return;
    const body = String(req.body?.body ?? "").trim();
    if (!body) return reply.code(422).send(problem(422, "validation", "Write the note"));
    const t = (await pool.query(`select id, reported_by_user_id from maintenance_ticket where id=$1 and property_id=$2`, [req.params.id, a.propertyId])).rows[0];
    if (!t) return reply.code(404).send(problem(404, "not_found", "No such ticket"));
    if (t.reported_by_user_id !== a.userId && !a.perms.has("maintenance.work")) return allow(a, "maintenance.work", reply);
    await tx(async c => {
      await c.query(
        `insert into maintenance_note (ticket_id, tenant_id, property_id, author_user_id, body) values ($1,$2,$3,$4,$5)`,
        [t.id, a.tenantId, a.propertyId, a.userId, body.slice(0, 4000)],
      );
      await audit(c, a, "maintenance_ticket", t.id, "maintenance.note", { payload: { body: body.slice(0, 500) } });
    });
    return { ok: true };
  });

  f.patch<{ Params: { id: string }; Body: { assigned_to_user_id?: string | null; priority?: string; description?: string; resolution?: string } }>("/maintenance/:id", async (req, reply) => {
    const a = await house(req, reply); if (!a || !allow(a, "maintenance.work", reply)) return;
    const allowed = ["assigned_to_user_id", "priority", "description", "resolution"]; const sets: string[] = []; const vals: unknown[] = [];
    for (const k of allowed) if (k in (req.body ?? {})) { vals.push((req.body as any)[k]); sets.push(`${k}=$${vals.length}`); }
    if (!sets.length) return reply.code(422).send(problem(422, "validation", "Nothing to change"));
    vals.push(req.params.id, a.propertyId);
    const r = await pool.query(`update maintenance_ticket set ${sets.join(",")}, version=version+1 where id=$${vals.length - 1} and property_id=$${vals.length}`, vals);
    if (!r.rowCount) return reply.code(404).send(problem(404, "not_found", "No such ticket"));
    return { ok: true };
  });

  f.post<{ Params: { id: string; cmd: string }; Body: { resolution?: string; room_back_in_service?: boolean } }>("/maintenance/:id/commands/:cmd", async (req, reply) => {
    const a = await house(req, reply); if (!a || !allow(a, "maintenance.work", reply)) return;
    const changed = await tx(async c => {
      const t = (await c.query(`select t.*, r.number room_number, rep.display_name reported_by, rep.email reporter_email, ast.name asset_name
        from maintenance_ticket t
        left join room r on r.id=t.room_id
        left join app_user rep on rep.id=t.reported_by_user_id
        left join asset ast on ast.id=t.asset_id
        where t.id=$1 and t.property_id=$2 for update of t`, [req.params.id, a.propertyId])).rows[0];
      if (!t) { reply.code(404); return problem(404, "not_found", "No such ticket"); }
      const to = nextFaultStatus(t.status, req.params.cmd);
      if (!to) { reply.code(409); return problem(409, "invalid_transition", `Cannot '${req.params.cmd}' a ticket that is ${String(t.status).toLowerCase().replace(/_/g, " ")}`); }
      const note = String(req.body?.resolution ?? "").trim() || null;
      await c.query(`update maintenance_ticket set status=$2, resolution=coalesce($3, resolution), resolved_at=case when $2 in ('DONE','CANCELLED') then now() else null end, assigned_to_user_id=case when $4='start' and assigned_to_user_id is null then $5 else assigned_to_user_id end, version=version+1 where id=$1`,
        [t.id, to, note, req.params.cmd, a.userId]);
      if (note) {
        await c.query(`insert into maintenance_note (ticket_id, tenant_id, property_id, author_user_id, body) values ($1,$2,$3,$4,$5)`, [t.id, a.tenantId, a.propertyId, a.userId, note.slice(0, 4000)]);
      }
      if (to === "DONE" && t.takes_room_out && t.room_id && req.body?.room_back_in_service) {
        const room = (await c.query(`select status from room where id=$1`, [t.room_id])).rows[0];
        if (room && ["OUT_OF_SERVICE", "OUT_OF_ORDER"].includes(room.status)) {
          await c.query(`update room set status='VACANT_DIRTY', status_before_oos=null, version=version+1 where id=$1`, [t.room_id]);
          await c.query(`insert into room_status_event (tenant_id, room_id, from_status, to_status, by_user_id, reason) values ($1,$2,$3,'VACANT_DIRTY',$4,$5)`, [a.tenantId, t.room_id, room.status, a.userId, `M-${t.number} done — safety check confirmed`]);
        }
      }
      await audit(c, a, "maintenance_ticket", t.id, "maintenance." + req.params.cmd, { from: t.status, to, reason: note ?? undefined });
      return { ok: true as const, status: to, ticket: t, note };
    });
    if (!changed || !("ticket" in changed)) return changed;
    const rules = await loadRouting(a.propertyId);
    const t = changed.ticket;
    if (changed.status === "DONE") {
      try {
        const { notifyGuestFollowUp } = await import("./guestFault.ts");
        await notifyGuestFollowUp(t.id);
      } catch { /* a staff ticket has no guest follow-up */ }
    }
    await deliver(a, statusNotices({
      number: t.number,
      description: t.description || t.title,
      location: t.room_number ? `Room ${t.room_number}` : (t.location || "the house"),
      equipment: t.equipment_label || t.asset_name || null,
      urgency: t.priority,
      reporter: t.reported_by || "Staff",
      foodSafety: !!t.food_safety,
      photo: !!t.photo,
    }, rules, changed.status, t.reporter_email, changed.note), t.id);
    return { ok: true, status: changed.status };
  });
}
