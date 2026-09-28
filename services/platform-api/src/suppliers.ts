/** Supplier register. Delivery reminders go to the stock orderer, and to the kitchen for food. */
import type { FastifyInstance } from "fastify";
import { pool, tx } from "./db.ts";
import { requireActor, allow, problem } from "./auth.ts";
import { audit } from "./groups.ts";
import { sendEmail } from "./email.ts";
import { cleanPhoto } from "../../../domains/ops/fault.ts";
import { parseStockRouting } from "../../../domains/ops/stock.ts";
import {
  SUPPLIER_CATEGORIES,
  deliveryAlert,
  deliveryNotices,
  isFoodSupplier,
  nextDelivery,
  parseDelivery,
  parseSupplier,
  supplierCode,
  type DeliveryNotice,
} from "../../../domains/procurement/register.ts";

async function actor(req: any, reply: any) {
  return requireActor(req, reply, ["ADMIN", "STAFF"]);
}

async function londonToday(): Promise<string> {
  return (await pool.query(`select (timezone('Europe/London', now()))::date::text d`)).rows[0].d;
}

async function routing(propertyId: string) {
  const row = (await pool.query(`select settings from property where id=$1`, [propertyId])).rows[0];
  return parseStockRouting(row?.settings?.stock_routing);
}

async function deliver(a: { tenantId: string; propertyId: string; userId?: string | null }, notes: DeliveryNotice[], supplierId: string) {
  for (const note of notes) {
    await sendEmail(a, { to: note.to, subject: note.subject, body: note.body, kind: `delivery_${note.audience}`, related_type: "supplier", related_id: supplierId });
  }
}

async function claimAlert(supplierId: string, kind: string, due: string): Promise<boolean> {
  const row = (await pool.query(
    `insert into supplier_alert (supplier_id, kind, due_on) values ($1,$2,$3) on conflict do nothing returning supplier_id`,
    [supplierId, kind, due],
  )).rows[0];
  return !!row;
}

export async function sendDueDeliveries(propertyId: string): Promise<number> {
  const emails = await routing(propertyId);
  const today = await londonToday();
  const prop = (await pool.query(`select tenant_id from property where id=$1`, [propertyId])).rows[0];
  if (!prop) return 0;
  const rows = (await pool.query(
    `select id, name, categories, next_delivery::text due from supplier
     where property_id=$1 and active and next_delivery is not null`,
    [propertyId],
  )).rows;
  let sent = 0;
  for (const row of rows) {
    const kind = deliveryAlert(row.due, today);
    if (!kind) continue;
    if (!(await claimAlert(row.id, kind, row.due))) continue;
    const notes = deliveryNotices({ name: row.name, kind, due: row.due }, isFoodSupplier(row.categories ?? []), emails);
    await deliver({ tenantId: prop.tenant_id, propertyId, userId: null }, notes, row.id);
    sent += 1;
  }
  return sent;
}

function view(row: any, today: string) {
  return {
    id: row.id,
    name: row.name,
    categories: row.categories ?? [],
    contact_name: row.contact_name,
    phone: row.contact_phone,
    email: row.contact_email,
    address: row.address,
    account_number: row.account_number,
    days: row.delivery_days ?? [],
    every_n: row.every_n,
    every_unit: row.every_unit,
    next_delivery: row.next_delivery,
    lead_time_days: row.lead_time_days,
    notes: row.notes,
    active: row.active,
    example: row.example,
    alert: deliveryAlert(row.next_delivery, today),
    deliveries: row.deliveries ?? [],
  };
}

export default async function supplierRoutes(f: FastifyInstance) {
  f.get("/v1/supplier-register", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "supplier.register", reply)) return;
    const today = await londonToday();
    const q = String(req.query?.q ?? "").trim().toLowerCase();
    const category = String(req.query?.category ?? "");
    const active = String(req.query?.active ?? "");
    const rows = (await pool.query(
      `select s.id, s.name, s.categories, s.contact_name, s.contact_phone, s.contact_email, s.address, s.account_number,
              s.delivery_days, s.every_n, s.every_unit, s.next_delivery::text, s.lead_time_days, s.notes, s.active, s.example,
              (select json_agg(json_build_object('status', d.status, 'note', d.note, 'has_photo', d.photo is not null, 'by_name', d.by_name, 'created_at', d.created_at) order by d.created_at desc)
               from (select * from supplier_delivery where supplier_id = s.id order by created_at desc limit 8) d) deliveries
       from supplier s where s.property_id=$1 order by s.name`,
      [a.propertyId],
    )).rows.map((row: any) => view(row, today));
    let items = rows;
    if (category) items = items.filter((item: { categories: string[] }) => item.categories.includes(category));
    if (active === "active") items = items.filter((item: { active: boolean }) => item.active);
    if (active === "inactive") items = items.filter((item: { active: boolean }) => !item.active);
    if (q) items = items.filter((item: { name: string; contact_name: string | null }) => `${item.name} ${item.contact_name ?? ""}`.toLowerCase().includes(q));
    return { items, categories: SUPPLIER_CATEGORIES, today };
  });

  f.post("/v1/supplier-register", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "supplier.register", reply)) return;
    const parsed = parseSupplier(req.body);
    if (!parsed.ok) return reply.code(422).send(problem(422, "validation", parsed.error));
    const code = supplierCode(parsed.name);
    const saved = await tx(async c => {
      const row = (await c.query(
        `insert into supplier (tenant_id, property_id, name, code, contact_name, contact_email, contact_phone, address, account_number, categories, delivery_days, every_n, every_unit, next_delivery, lead_time_days, notes, active)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id`,
        [a.tenantId, a.propertyId, parsed.name, code, parsed.contactName || null, parsed.email || null, parsed.phone || null, parsed.address || null, parsed.account || null,
          parsed.categories, parsed.days, parsed.every, parsed.unit, parsed.nextDelivery || null, parsed.lead, parsed.notes || null, parsed.active],
      )).rows[0];
      await audit(c, a, "supplier", row.id, "supplier.add", { payload: { name: parsed.name } });
      return row;
    }).catch((err: { code?: string }) => {
      if (err.code === "23505") { reply.code(409); return problem(409, "conflict", "A supplier with that name is already on the list"); }
      throw err;
    });
    if (!saved || !("id" in saved)) return saved;
    reply.code(201);
    return { id: saved.id };
  });

  f.patch("/v1/supplier-register/:id", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "supplier.register", reply)) return;
    const parsed = parseSupplier(req.body);
    if (!parsed.ok) return reply.code(422).send(problem(422, "validation", parsed.error));
    const saved = await tx(async c => {
      const row = (await c.query(`select id from supplier where id=$1 and property_id=$2 for update`, [req.params.id, a.propertyId])).rows[0];
      if (!row) { reply.code(404); return problem(404, "not_found", "That supplier is not on the list"); }
      await c.query(
        `update supplier set name=$2, contact_name=$3, contact_email=$4, contact_phone=$5, address=$6, account_number=$7, categories=$8, delivery_days=$9, every_n=$10, every_unit=$11, next_delivery=$12, lead_time_days=$13, notes=$14, active=$15, example=false
         where id=$1`,
        [row.id, parsed.name, parsed.contactName || null, parsed.email || null, parsed.phone || null, parsed.address || null, parsed.account || null, parsed.categories, parsed.days, parsed.every, parsed.unit, parsed.nextDelivery || null, parsed.lead, parsed.notes || null, parsed.active],
      );
      await audit(c, a, "supplier", row.id, "supplier.edit", { payload: { name: parsed.name } });
      return { ok: true };
    });
    return saved;
  });

  f.post("/v1/supplier-register/:id/deliveries", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "supplier.register", reply)) return;
    const parsed = parseDelivery(req.body);
    if (!parsed.ok) return reply.code(422).send(problem(422, "validation", parsed.error));
    const photo = cleanPhoto(req.body?.photo);
    if (!photo.ok) return reply.code(422).send(problem(422, "validation", photo.error));
    const today = await londonToday();
    const saved = await tx(async c => {
      const row = (await c.query(
        `select id, name, categories, delivery_days, every_n, every_unit, next_delivery::text
         from supplier where id=$1 and property_id=$2 for update`,
        [req.params.id, a.propertyId],
      )).rows[0];
      if (!row) { reply.code(404); return problem(404, "not_found", "That supplier is not on the list"); }
      const due = row.next_delivery || today;
      await c.query(
        `insert into supplier_delivery (supplier_id, tenant_id, property_id, status, note, photo, due_on, by_user_id, by_name)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [row.id, a.tenantId, a.propertyId, parsed.status, parsed.note || null, photo.photo, due, a.userId, a.name],
      );
      let next: string | null = row.next_delivery || null;
      if (parsed.status === "received" || parsed.status === "partial") {
        next = nextDelivery(today, row.delivery_days ?? [], row.every_n, row.every_unit);
        await c.query(`update supplier set next_delivery=$2, example=false where id=$1`, [row.id, next]);
      }
      await audit(c, a, "supplier", row.id, "supplier.delivery", { payload: { status: parsed.status } });
      return { ok: true, status: parsed.status as "received" | "partial" | "missed", name: row.name as string, categories: (row.categories ?? []) as string[], due, next };
    });
    if (!saved || !("ok" in saved)) return saved;
    if (saved.status === "missed") {
      if (await claimAlert(req.params.id, "missed", saved.due)) {
        const notes = deliveryNotices({ name: saved.name, kind: "missed", due: saved.due }, isFoodSupplier(saved.categories), await routing(a.propertyId));
        await deliver(a, notes, req.params.id);
      }
    }
    return { ok: true, next_delivery: saved.next };
  });
}
