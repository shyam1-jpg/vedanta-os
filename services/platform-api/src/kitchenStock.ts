import type { FastifyInstance } from "fastify";
import { pool, tx } from "./db.ts";
import { requireActor, allow, problem } from "./auth.ts";
import { audit } from "./groups.ts";
import { sendEmail } from "./email.ts";
import {
  applyCount,
  parseStockRouting,
  stockAlert,
  stockNotices,
  type StockNotice,
  type StockRouting,
} from "../../../domains/ops/stock.ts";

async function actor(req: any, reply: any) {
  return requireActor(req, reply, ["ADMIN", "STAFF"]);
}

function uuidOrEmpty(value: unknown): string | null {
  const id = String(value ?? "").trim();
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function loadRouting(propertyId: string): Promise<StockRouting> {
  const row = (await pool.query(`select settings from property where id=$1`, [propertyId])).rows[0];
  return parseStockRouting(row?.settings?.stock_routing);
}

async function preferredSupplier(itemId: string) {
  const row = (await pool.query(
    `select s.name, s.contact_phone phone, s.contact_email email
     from kitchen_stock_item i left join supplier s on s.id = i.supplier_id
     where i.id=$1`,
    [itemId],
  )).rows[0];
  return row?.name ? { name: row.name as string, phone: row.phone as string | null, email: row.email as string | null } : null;
}

async function deliver(a: { tenantId: string; propertyId: string; userId?: string | null }, notes: StockNotice[], itemId: string) {
  for (const note of notes) {
    await sendEmail(a, { to: note.to, subject: note.subject, body: note.body, kind: `stock_${note.audience}`, related_type: "kitchen_stock_item", related_id: itemId });
  }
}

function view(row: any) {
  const quantity = num(row.quantity);
  const low_threshold = num(row.low_threshold);
  return {
    ...row,
    quantity,
    low_threshold,
    low: quantity < low_threshold,
  };
}

export default async function kitchenStock(f: FastifyInstance) {
  f.get("/v1/settings/stock-alerts", async (req, reply) => {
    const a = await actor(req, reply); if (!a) return;
    if (!a.perms.has("package.manage") && !a.perms.has("kitchen.stock")) {
      return reply.code(403).send(problem(403, "forbidden", "You cannot open stock settings"));
    }
    const emails = await loadRouting(a.propertyId);
    return {
      emails,
      receives: {
        kitchen: "Told once when an item falls below its line.",
        buyer: "The person who orders stock is copied on that same note.",
      },
    };
  });

  f.put("/v1/settings/stock-alerts", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "package.manage", reply)) return;
    const emails = parseStockRouting(req.body?.emails ?? req.body);
    await pool.query(
      `update property set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{stock_routing}', $2::jsonb, true) where id=$1`,
      [a.propertyId, JSON.stringify(emails)],
    );
    return { emails };
  });

  f.get("/v1/kitchen-stock", async (req, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "kitchen.stock", reply)) return;
    const items = await pool.query(
      `select i.id, i.name, i.unit, i.quantity, i.low_threshold, i.supplier, i.supplier_id, i.notes, i.example, i.active, i.low_alerted_at, i.updated_at,
              s.name supplier_name, s.contact_phone supplier_phone, s.contact_email supplier_email
       from kitchen_stock_item i
       left join supplier s on s.id = i.supplier_id
       where i.property_id=$1 and i.active order by i.name`,
      [a.propertyId],
    );
    const ids = items.rows.map((row: { id: string }) => row.id);
    const logs = ids.length
      ? await pool.query(
        `select item_id, action, quantity_before, quantity_after, delta, note, by_name, created_at
         from kitchen_stock_log where item_id = any($1::uuid[]) order by created_at desc limit 400`,
        [ids],
      )
      : { rows: [] };
    return {
      items: items.rows.map((row: any) => ({
        ...view(row),
        log: logs.rows.filter((entry: { item_id: string }) => entry.item_id === row.id).slice(0, 8).map((entry: any) => ({
          ...entry,
          quantity_before: entry.quantity_before == null ? null : num(entry.quantity_before),
          quantity_after: entry.quantity_after == null ? null : num(entry.quantity_after),
          delta: entry.delta == null ? null : num(entry.delta),
        })),
      })),
      low: items.rows.map(view).filter((row: { low: boolean }) => row.low).map((row: { id: string; name: string; quantity: number; unit: string; supplier_name?: string | null; supplier_phone?: string | null; supplier_email?: string | null }) => ({
        id: row.id, name: row.name, quantity: row.quantity, unit: row.unit,
        supplier_name: row.supplier_name ?? null, supplier_phone: row.supplier_phone ?? null, supplier_email: row.supplier_email ?? null,
      })),
    };
  });

  f.post("/v1/kitchen-stock", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "kitchen.stock", reply)) return;
    const name = String(req.body?.name ?? "").trim().slice(0, 120);
    const unit = String(req.body?.unit ?? "").trim().slice(0, 40);
    if (!name || !unit) return reply.code(422).send(problem(422, "validation", "Name the item and its unit"));
    const quantity = Math.max(0, num(req.body?.quantity ?? 0));
    const low = Math.max(0, num(req.body?.low_threshold ?? req.body?.low ?? 0));
    const taken = (await pool.query(`select id from kitchen_stock_item where property_id=$1 and name=$2`, [a.propertyId, name])).rows[0];
    if (taken) return reply.code(409).send(problem(409, "conflict", "That item is already on the list"));
    const saved = await tx(async c => {
      const r = await c.query(
        `insert into kitchen_stock_item (tenant_id, property_id, name, unit, quantity, low_threshold, supplier, supplier_id, notes)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id, quantity, low_threshold`,
        [a.tenantId, a.propertyId, name, unit, quantity, low, String(req.body?.supplier ?? "").trim().slice(0, 160) || null, uuidOrEmpty(req.body?.supplier_id), String(req.body?.notes ?? "").trim().slice(0, 500) || null],
      );
      await c.query(
        `insert into kitchen_stock_log (item_id, tenant_id, property_id, action, quantity_before, quantity_after, delta, note, by_user_id, by_name)
         values ($1,$2,$3,'set',0,$4,$4,$5,$6,$7)`,
        [r.rows[0].id, a.tenantId, a.propertyId, quantity, "Added to the list", a.userId, a.name],
      );
      await audit(c, a, "kitchen_stock_item", r.rows[0].id, "kitchen.stock.add", { payload: { name, quantity } });
      return r.rows[0];
    });
    const decision = stockAlert(low, quantity, low, false);
    if (decision === "send") {
      await pool.query(`update kitchen_stock_item set low_alerted_at=now() where id=$1`, [saved.id]);
      await deliver(a, stockNotices({ name, quantity, unit, threshold: low }, await loadRouting(a.propertyId), await preferredSupplier(saved.id)), saved.id);
    }
    reply.code(201);
    return { id: saved.id };
  });

  f.patch("/v1/kitchen-stock/:id", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "kitchen.stock", reply)) return;
    const saved = await tx(async c => {
      const row = (await c.query(`select * from kitchen_stock_item where id=$1 and property_id=$2 for update`, [req.params.id, a.propertyId])).rows[0];
      if (!row) { reply.code(404); return problem(404, "not_found", "That item is not on the list"); }
      const name = req.body?.name != null ? String(req.body.name).trim().slice(0, 120) : row.name;
      const unit = req.body?.unit != null ? String(req.body.unit).trim().slice(0, 40) : row.unit;
      if (!name || !unit) { reply.code(422); return problem(422, "validation", "Name the item and its unit"); }
      const low = req.body?.low_threshold != null || req.body?.low != null ? Math.max(0, num(req.body.low_threshold ?? req.body.low)) : num(row.low_threshold);
      const supplier = req.body?.supplier != null ? String(req.body.supplier).trim().slice(0, 160) || null : row.supplier;
      const supplierId = req.body?.supplier_id !== undefined ? uuidOrEmpty(req.body.supplier_id) : row.supplier_id;
      const notes = req.body?.notes != null ? String(req.body.notes).trim().slice(0, 500) || null : row.notes;
      const example = req.body?.example != null ? !!req.body.example : row.example;
      const active = req.body?.active != null ? !!req.body.active : row.active;
      await c.query(
        `update kitchen_stock_item set name=$2, unit=$3, low_threshold=$4, supplier=$5, supplier_id=$6, notes=$7, example=$8, active=$9, updated_at=now() where id=$1`,
        [row.id, name, unit, low, supplier, supplierId, notes, example, active],
      );
      await c.query(
        `insert into kitchen_stock_log (item_id, tenant_id, property_id, action, quantity_before, quantity_after, delta, note, by_user_id, by_name)
         values ($1,$2,$3,'edit',$4,$4,0,$5,$6,$7)`,
        [row.id, a.tenantId, a.propertyId, num(row.quantity), "Updated the item", a.userId, a.name],
      );
      await audit(c, a, "kitchen_stock_item", row.id, "kitchen.stock.edit", { payload: { name, low } });
      return { id: row.id, name, unit, quantity: num(row.quantity), low, alerted: !!row.low_alerted_at };
    });
    if (!saved || !("id" in saved)) return saved;
    const decision = stockAlert(saved.low, saved.quantity, saved.low, saved.alerted);
    if (decision === "send") {
      await pool.query(`update kitchen_stock_item set low_alerted_at=now() where id=$1`, [saved.id]);
      await deliver(a, stockNotices({ name: saved.name, quantity: saved.quantity, unit: saved.unit, threshold: saved.low }, await loadRouting(a.propertyId), await preferredSupplier(saved.id)), saved.id);
    } else if (decision === "clear") {
      await pool.query(`update kitchen_stock_item set low_alerted_at=null where id=$1`, [saved.id]);
    }
    return { ok: true };
  });

  f.post("/v1/kitchen-stock/:id/count", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "kitchen.stock", reply)) return;
    const saved = await tx(async c => {
      const row = (await c.query(`select * from kitchen_stock_item where id=$1 and property_id=$2 and active for update`, [req.params.id, a.propertyId])).rows[0];
      if (!row) { reply.code(404); return problem(404, "not_found", "That item is not on the list"); }
      const parsed = applyCount(num(row.quantity), req.body?.op, req.body?.amount ?? req.body?.quantity);
      if (!parsed.ok) { reply.code(422); return problem(422, "validation", parsed.error); }
      const decision = stockAlert(num(row.quantity), parsed.next, num(row.low_threshold), !!row.low_alerted_at);
      await c.query(
        `update kitchen_stock_item set quantity=$2, low_alerted_at=case when $3='clear' then null when $3='send' then now() else low_alerted_at end, updated_at=now() where id=$1`,
        [row.id, parsed.next, decision],
      );
      await c.query(
        `insert into kitchen_stock_log (item_id, tenant_id, property_id, action, quantity_before, quantity_after, delta, by_user_id, by_name)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [row.id, a.tenantId, a.propertyId, parsed.action, num(row.quantity), parsed.next, parsed.delta, a.userId, a.name],
      );
      await audit(c, a, "kitchen_stock_item", row.id, "kitchen.stock." + parsed.action, { payload: { from: num(row.quantity), to: parsed.next } });
      return { id: row.id as string, name: row.name as string, unit: row.unit as string, quantity: parsed.next, threshold: num(row.low_threshold), decision };
    });
    if (!saved || !("decision" in saved)) return saved;
    if (saved.decision === "send") {
      await deliver(a, stockNotices({ name: saved.name, quantity: saved.quantity, unit: saved.unit, threshold: saved.threshold }, await loadRouting(a.propertyId), await preferredSupplier(saved.id)), saved.id);
    }
    return { ok: true, quantity: saved.quantity, low: saved.quantity < saved.threshold };
  });
}
