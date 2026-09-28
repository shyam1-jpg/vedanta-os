import type { FastifyInstance } from "fastify";
import { pool, tx } from "./db.ts";
import { requireActor, allow, problem } from "./auth.ts";
import { audit } from "./groups.ts";
import { sendEmail } from "./email.ts";
import {
  applyCount,
  groupOrders,
  orderMessage,
  parseReorderSettings,
  parseStockRouting,
  stockAlert,
  stockNotices,
  vegetarianName,
  type OrderItem,
  type ReorderSettings,
  type StockNotice,
  type StockRouting,
  type SupplierOrder,
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

const ORDER_APPROVER = new Set(["SYSTEM_OWNER", "GENERAL_MANAGER", "OPERATIONS_MANAGER", "HEAD_CHEF", "KITCHEN_MANAGER", "PURCHASING"]);

function canApproveOrder(a: { role: string; perms: Set<string> }): boolean {
  return a.perms.has("package.manage") || ORDER_APPROVER.has(a.role);
}

async function loadRouting(propertyId: string): Promise<StockRouting> {
  const row = (await pool.query(`select settings from property where id=$1`, [propertyId])).rows[0];
  return parseStockRouting(row?.settings?.stock_routing);
}

async function loadReorder(propertyId: string): Promise<ReorderSettings> {
  const row = (await pool.query(`select settings from property where id=$1`, [propertyId])).rows[0];
  return parseReorderSettings(row?.settings?.stock_reorder);
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
  const reorderRaw = row.reorder_at;
  return {
    ...row,
    quantity,
    low_threshold,
    par_level: num(row.par_level),
    reorder_at: reorderRaw == null || reorderRaw === "" ? null : num(reorderRaw),
    pack_size: num(row.pack_size) > 0 ? num(row.pack_size) : 1,
    low: quantity < low_threshold,
  };
}

async function selectItems(propertyId: string): Promise<{ rows: any[] }> {
  const base = `select i.id, i.name, i.unit, i.quantity, i.low_threshold, i.supplier, i.supplier_id, i.notes, i.example, i.active, i.low_alerted_at, i.updated_at,
              s.name supplier_name, s.contact_phone supplier_phone, s.contact_email supplier_email`;
  const from = `from kitchen_stock_item i left join supplier s on s.id = i.supplier_id where i.property_id=$1 and i.active order by i.name`;
  try {
    const rich = await pool.query(`${base}, i.par_level, i.reorder_at, i.pack_size, i.source ${from}`, [propertyId]);
    return { rows: rich.rows };
  } catch {
    try {
      const reorder = await pool.query(`${base}, i.par_level, i.reorder_at, i.pack_size ${from}`, [propertyId]);
      return { rows: reorder.rows.map((row: Record<string, unknown>) => ({ ...row, source: "purchased" })) };
    } catch {
      const plain = await pool.query(`${base} ${from}`, [propertyId]);
      return { rows: plain.rows.map((row: Record<string, unknown>) => ({ ...row, par_level: 0, reorder_at: null, pack_size: 1, source: "purchased" })) };
    }
  }
}

async function writeLines(orderId: string, lines: SupplierOrder["lines"]) {
  await pool.query(`delete from kitchen_order_line where order_id=$1`, [orderId]);
  for (const line of lines) {
    await pool.query(
      `insert into kitchen_order_line (order_id, item_id, name, unit, packs, pack_size, quantity) values ($1,$2,$3,$4,$5,$6,$7)`,
      [orderId, line.itemId, line.name, line.unit, line.packs, line.packSize, line.quantity],
    );
  }
}

async function emailOrder(a: { tenantId: string; propertyId: string; userId?: string | null }, orderId: string, order: SupplierOrder) {
  if (!order.autoSend || !order.supplierEmail) return { sent: false as const, status: "" };
  const message = orderMessage(order);
  const result = await sendEmail(a, {
    to: order.supplierEmail,
    subject: message.subject,
    body: message.body,
    kind: "stock_order",
    audience: "staff",
    related_type: "kitchen_order",
    related_id: orderId,
  });
  if (result.status === "FAILED") return { sent: false as const, status: result.status };
  const note = result.status === "SENT" ? null : "Logged. Mail is not configured, so this was not delivered to the supplier.";
  await pool.query(
    `update kitchen_order set status='sent', auto_sent=$2, sent_at=now(), sent_to=$3, supplier_response=coalesce(supplier_response, $4), updated_at=now() where id=$1`,
    [orderId, order.autoSend, order.supplierEmail, note],
  );
  return { sent: true as const, status: result.status };
}

/** One open draft per supplier. A sent order is left alone until it is delivered or cancelled. */
async function syncReorder(a: { tenantId: string; propertyId: string; userId?: string | null }) {
  const settings = await loadReorder(a.propertyId);
  if (!settings.enabled) return;
  let rows: Record<string, unknown>[];
  try {
    rows = (await pool.query(
      `select i.id, i.name, i.unit, i.quantity, i.low_threshold, i.par_level, i.reorder_at, i.pack_size, i.supplier_id,
              s.name supplier_name, s.contact_email supplier_email
       from kitchen_stock_item i
       left join supplier s on s.id = i.supplier_id
       where i.property_id=$1 and i.active`,
      [a.propertyId],
    )).rows;
  } catch (err) {
    console.error("[kitchen-stock] reorder skipped", err instanceof Error ? err.message : err);
    return;
  }
  const items: OrderItem[] = rows.map(row => ({
    id: String(row.id),
    name: String(row.name),
    unit: String(row.unit),
    quantity: num(row.quantity),
    par: num(row.par_level),
    threshold: row.reorder_at == null ? null : num(row.reorder_at),
    low: num(row.low_threshold),
    packSize: num(row.pack_size),
    supplierId: row.supplier_id ? String(row.supplier_id) : null,
    supplierName: row.supplier_name ? String(row.supplier_name) : null,
    supplierEmail: row.supplier_email ? String(row.supplier_email) : null,
  }));
  const wanted = groupOrders(items, settings);
  let open: { id: string; supplier_key: string; status: string }[] = [];
  try {
    open = (await pool.query(
      `select id, supplier_key, status from kitchen_order where property_id=$1 and status in ('draft','approved','sent')`,
      [a.propertyId],
    )).rows;
  } catch (err) {
    console.error("[kitchen-stock] order log skipped", err instanceof Error ? err.message : err);
    return;
  }
  const seen = new Set<string>();
  for (const order of wanted) {
    seen.add(order.supplierKey);
    const existing = open.find(row => row.supplier_key === order.supplierKey);
    if (existing && existing.status !== "draft") continue;
    let orderId = existing?.id ?? "";
    if (!orderId) {
      const created = (await pool.query(
        `insert into kitchen_order (tenant_id, property_id, supplier_id, supplier_key, supplier_name, status)
         values ($1,$2,$3,$4,$5,'draft') returning id`,
        [a.tenantId, a.propertyId, order.supplierId, order.supplierKey, order.supplierName],
      )).rows[0];
      orderId = created.id;
    }
    await writeLines(orderId, order.lines);
    if (order.autoSend && order.supplierEmail) await emailOrder(a, orderId, order);
  }
  for (const row of open) {
    if (row.status !== "draft" || seen.has(row.supplier_key)) continue;
    await pool.query(`update kitchen_order set status='cancelled', updated_at=now() where id=$1 and status='draft'`, [row.id]);
  }
}

export default async function kitchenStock(f: FastifyInstance) {
  f.get("/v1/settings/stock-alerts", async (req, reply) => {
    const a = await actor(req, reply); if (!a) return;
    if (!a.perms.has("package.manage") && !a.perms.has("kitchen.stock")) {
      return reply.code(403).send(problem(403, "forbidden", "You cannot open stock settings"));
    }
    const emails = await loadRouting(a.propertyId);
    const reorder = await loadReorder(a.propertyId);
    const suppliers = (await pool.query(`select id, name from supplier where property_id=$1 and active order by name`, [a.propertyId])).rows as { id: string; name: string }[];
    return {
      emails,
      reorder: { enabled: reorder.enabled, auto_send: reorder.autoSend },
      suppliers,
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
    let reorder = await loadReorder(a.propertyId);
    if (req.body?.reorder) {
      reorder = parseReorderSettings(req.body.reorder);
      await pool.query(
        `update property set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{stock_reorder}', $2::jsonb, true) where id=$1`,
        [a.propertyId, JSON.stringify({ enabled: reorder.enabled, auto_send: reorder.autoSend })],
      );
    }
    return { emails, reorder: { enabled: reorder.enabled, auto_send: reorder.autoSend } };
  });

  f.get("/v1/kitchen-stock", async (req, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "kitchen.stock", reply)) return;
    const items = await selectItems(a.propertyId);
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
    const food = vegetarianName(name);
    if (!food.ok) return reply.code(422).send(problem(422, "validation", food.error));
    const quantity = Math.max(0, num(req.body?.quantity ?? 0));
    const low = Math.max(0, num(req.body?.low_threshold ?? req.body?.low ?? 0));
    const par = Math.max(0, num(req.body?.par_level ?? req.body?.par ?? 0));
    const reorderAt = req.body?.reorder_at == null || req.body?.reorder_at === "" ? null : Math.max(0, num(req.body.reorder_at));
    const pack = Math.max(0.001, num(req.body?.pack_size ?? 1));
    const taken = (await pool.query(`select id from kitchen_stock_item where property_id=$1 and name=$2`, [a.propertyId, name])).rows[0];
    if (taken) return reply.code(409).send(problem(409, "conflict", "That item is already on the list"));
    const supplierNote = String(req.body?.supplier ?? "").trim().slice(0, 160) || null;
    const supplierId = uuidOrEmpty(req.body?.supplier_id);
    const notes = String(req.body?.notes ?? "").trim().slice(0, 500) || null;
    const saved = await tx(async c => {
      await c.query(`SAVEPOINT stock_reorder_cols`);
      let r;
      try {
        r = await c.query(
          `insert into kitchen_stock_item (tenant_id, property_id, name, unit, quantity, low_threshold, supplier, supplier_id, notes, par_level, reorder_at, pack_size)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id, quantity, low_threshold`,
          [a.tenantId, a.propertyId, name, unit, quantity, low, supplierNote, supplierId, notes, par, reorderAt, pack],
        );
        await c.query(`RELEASE SAVEPOINT stock_reorder_cols`);
      } catch {
        await c.query(`ROLLBACK TO SAVEPOINT stock_reorder_cols`);
        r = await c.query(
          `insert into kitchen_stock_item (tenant_id, property_id, name, unit, quantity, low_threshold, supplier, supplier_id, notes)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id, quantity, low_threshold`,
          [a.tenantId, a.propertyId, name, unit, quantity, low, supplierNote, supplierId, notes],
        );
      }
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
    await syncReorder(a);
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
      const food = vegetarianName(name);
      if (!food.ok) { reply.code(422); return problem(422, "validation", food.error); }
      const low = req.body?.low_threshold != null || req.body?.low != null ? Math.max(0, num(req.body.low_threshold ?? req.body.low)) : num(row.low_threshold);
      const par = req.body?.par_level != null || req.body?.par != null ? Math.max(0, num(req.body.par_level ?? req.body.par)) : num(row.par_level);
      const reorderAt = req.body?.reorder_at !== undefined
        ? (req.body.reorder_at == null || req.body.reorder_at === "" ? null : Math.max(0, num(req.body.reorder_at)))
        : (row.reorder_at == null ? null : num(row.reorder_at));
      const pack = req.body?.pack_size != null ? Math.max(0.001, num(req.body.pack_size)) : (num(row.pack_size) || 1);
      const supplier = req.body?.supplier != null ? String(req.body.supplier).trim().slice(0, 160) || null : row.supplier;
      const supplierId = req.body?.supplier_id !== undefined ? uuidOrEmpty(req.body.supplier_id) : row.supplier_id;
      const notes = req.body?.notes != null ? String(req.body.notes).trim().slice(0, 500) || null : row.notes;
      const example = req.body?.example != null ? !!req.body.example : row.example;
      const active = req.body?.active != null ? !!req.body.active : row.active;
      await c.query(`SAVEPOINT stock_reorder_cols`);
      try {
        await c.query(
          `update kitchen_stock_item set name=$2, unit=$3, low_threshold=$4, supplier=$5, supplier_id=$6, notes=$7, example=$8, active=$9, par_level=$10, reorder_at=$11, pack_size=$12, updated_at=now() where id=$1`,
          [row.id, name, unit, low, supplier, supplierId, notes, example, active, par, reorderAt, pack],
        );
        await c.query(`RELEASE SAVEPOINT stock_reorder_cols`);
      } catch {
        await c.query(`ROLLBACK TO SAVEPOINT stock_reorder_cols`);
        await c.query(
          `update kitchen_stock_item set name=$2, unit=$3, low_threshold=$4, supplier=$5, supplier_id=$6, notes=$7, example=$8, active=$9, updated_at=now() where id=$1`,
          [row.id, name, unit, low, supplier, supplierId, notes, example, active],
        );
      }
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
    await syncReorder(a);
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
    await syncReorder(a);
    return { ok: true, quantity: saved.quantity, low: saved.quantity < saved.threshold };
  });

  f.get("/v1/kitchen-stock/orders", async (req, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "kitchen.stock", reply)) return;
    const reorder = await loadReorder(a.propertyId);
    try {
      const orders = await pool.query(
        `select id, supplier_id, supplier_name, status, auto_sent, approved_name, approved_at, sent_at, sent_to, supplier_response, delivered_at, created_at
         from kitchen_order where property_id=$1 order by created_at desc limit 40`,
        [a.propertyId],
      );
      const ids = orders.rows.map((row: { id: string }) => row.id);
      const lines = ids.length
        ? await pool.query(`select order_id, name, unit, packs, pack_size, quantity from kitchen_order_line where order_id = any($1::uuid[])`, [ids])
        : { rows: [] as Record<string, unknown>[] };
      return {
        enabled: reorder.enabled,
        can_approve: canApproveOrder(a),
        items: orders.rows.map((row: { id: string }) => ({
          ...row,
          lines: lines.rows.filter((line: { order_id: string }) => line.order_id === row.id).map((line: any) => ({
            name: line.name, unit: line.unit, packs: num(line.packs), pack_size: num(line.pack_size), quantity: num(line.quantity),
          })),
        })),
      };
    } catch {
      return { enabled: reorder.enabled, can_approve: canApproveOrder(a), items: [] };
    }
  });

  f.post("/v1/kitchen-stock/orders/:id/approve", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "kitchen.stock", reply)) return;
    if (!canApproveOrder(a)) return reply.code(403).send(problem(403, "forbidden", "A manager approves a kitchen order"));
    const locked = await tx(async c => {
      const row = (await c.query(`select * from kitchen_order where id=$1 and property_id=$2 for update`, [req.params.id, a.propertyId])).rows[0];
      if (!row) return null;
      if (row.status !== "draft") return { blocked: row.status as string };
      await c.query(
        `update kitchen_order set status='approved', approved_by=$2, approved_name=$3, approved_at=now(), updated_at=now() where id=$1`,
        [row.id, a.userId, a.name],
      );
      await audit(c, a, "kitchen_order", row.id, "kitchen.order.approve", { payload: { supplier: row.supplier_name } });
      return row;
    });
    if (!locked) return reply.code(404).send(problem(404, "not_found", "No such order"));
    if ("blocked" in locked) return reply.code(422).send(problem(422, "validation", "That order is no longer a draft"));
    const lines = (await pool.query(`select name, unit, packs, pack_size, quantity from kitchen_order_line where order_id=$1`, [locked.id])).rows;
    const supplier = locked.supplier_id
      ? (await pool.query(`select contact_email from supplier where id=$1`, [locked.supplier_id])).rows[0]
      : null;
    const email = supplier?.contact_email ? String(supplier.contact_email) : "";
    const message = orderMessage({
      supplierName: locked.supplier_name,
      lines: lines.map((line: any) => ({ itemId: "", name: line.name, unit: line.unit, packs: num(line.packs), packSize: num(line.pack_size), quantity: num(line.quantity) })),
    });
    if (!email) {
      await pool.query(`update kitchen_order set supplier_response=$2, updated_at=now() where id=$1`, [locked.id, "Approved. No supplier email, so nothing was sent."]);
      return { ok: true, status: "approved" };
    }
    const result = await sendEmail(a, { to: email, subject: message.subject, body: message.body, kind: "stock_order", audience: "staff", related_type: "kitchen_order", related_id: locked.id });
    if (result.status === "FAILED") {
      await pool.query(`update kitchen_order set supplier_response=$2, updated_at=now() where id=$1`, [locked.id, "Approved. The email did not send."]);
      return { ok: true, status: "approved" };
    }
    const note = result.status === "SENT" ? null : "Logged. Mail is not configured, so this was not delivered to the supplier.";
    await pool.query(
      `update kitchen_order set status='sent', sent_at=now(), sent_to=$2, supplier_response=coalesce($3, supplier_response), updated_at=now() where id=$1`,
      [locked.id, email, note],
    );
    return { ok: true, status: "sent" };
  });

  f.post("/v1/kitchen-stock/orders/:id/response", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "kitchen.stock", reply)) return;
    const text = String(req.body?.response ?? "").trim().slice(0, 500);
    if (!text) return reply.code(422).send(problem(422, "validation", "Write what the supplier said"));
    const updated = await pool.query(
      `update kitchen_order set supplier_response=$3, updated_at=now() where id=$1 and property_id=$2 and status in ('approved','sent','delivered') returning id`,
      [req.params.id, a.propertyId, text],
    );
    if (!updated.rowCount) return reply.code(404).send(problem(404, "not_found", "No such order"));
    return { ok: true };
  });

  f.post("/v1/kitchen-stock/orders/:id/deliver", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "kitchen.stock", reply)) return;
    const updated = await tx(async c => {
      const row = (await c.query(
        `update kitchen_order set status='delivered', delivered_at=now(), updated_at=now() where id=$1 and property_id=$2 and status in ('approved','sent') returning id`,
        [req.params.id, a.propertyId],
      )).rows[0];
      if (!row) return null;
      await audit(c, a, "kitchen_order", row.id, "kitchen.order.deliver", {});
      return row;
    });
    if (!updated) return reply.code(404).send(problem(404, "not_found", "No open order to mark delivered"));
    return { ok: true };
  });
}
