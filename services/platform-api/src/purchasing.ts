/**
 * Purchasing & supplier workflow
 * Requisition → approval → PO → delivery → quality check → invoice → 3-way match
 */
import type { FastifyInstance } from "fastify";
import { pool } from "./db.ts";
import { requireActor, allow, problem } from "./auth.ts";

export default async function purchasing(f: FastifyInstance) {

  // ── SUPPLIERS ─────────────────────────────────────────────────────────

  f.get("/v1/suppliers", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const r = await pool.query(`SELECT * FROM supplier WHERE property_id=$1 AND active ORDER BY name`, [a.propertyId]);
    return { items: r.rows };
  });

  f.post("/v1/suppliers", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.update", reply)) return;
    const { name, code, contact_name, contact_email, contact_phone, address, payment_terms, notes } = req.body ?? {};
    if (!name || !code) return reply.code(422).send(problem(422, "validation", "name and code required"));
    const r = (await pool.query(`INSERT INTO supplier (tenant_id, property_id, name, code, contact_name, contact_email, contact_phone, address, payment_terms, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [a.tenantId, a.propertyId, name, code.toUpperCase(), contact_name ?? null, contact_email ?? null, contact_phone ?? null, address ?? null, payment_terms ?? 30, notes ?? null])).rows[0];
    return { id: r.id };
  });

  // ── REQUISITIONS ──────────────────────────────────────────────────────

  f.get("/v1/requisitions", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const r = await pool.query(`
      SELECT pr.id, pr.department, pr.title, pr.urgency, pr.status, pr.required_by::text, pr.created_at,
             u.display_name AS requested_by_name, approver.display_name AS approved_by_name,
             count(ri.id) AS item_count
      FROM purchase_requisition pr
      JOIN app_user u ON u.id = pr.requested_by
      LEFT JOIN app_user approver ON approver.id = pr.approved_by
      LEFT JOIN requisition_item ri ON ri.requisition_id = pr.id
      WHERE pr.property_id = $1
      GROUP BY pr.id, u.display_name, approver.display_name
      ORDER BY pr.created_at DESC LIMIT 100`, [a.propertyId]);
    return { items: r.rows };
  });

  f.post("/v1/requisitions", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const { department, title, urgency, required_by, notes, items } = req.body ?? {};
    if (!department || !title) return reply.code(422).send(problem(422, "validation", "department and title required"));
    const pr = (await pool.query(`INSERT INTO purchase_requisition (tenant_id, property_id, department, title, urgency, required_by, notes, status, requested_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'submitted',$8) RETURNING id`,
      [a.tenantId, a.propertyId, department, title, urgency ?? "normal", required_by ?? null, notes ?? null, a.userId])).rows[0];
    if (items?.length) {
      for (const item of items) {
        await pool.query(`INSERT INTO requisition_item (requisition_id, description, quantity, unit, unit_price, supplier_id, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [pr.id, item.description, item.quantity ?? 1, item.unit ?? null, item.unit_price ?? null, item.supplier_id ?? null, item.notes ?? null]);
      }
    }
    return { id: pr.id };
  });

  f.post<{ Params: { id: string } }>("/v1/requisitions/:id/approve", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.update", reply)) return;
    await pool.query(`UPDATE purchase_requisition SET status='approved', approved_by=$2, approved_at=now() WHERE id=$1 AND property_id=$3`, [req.params.id, a.userId, a.propertyId]);
    return { ok: true };
  });

  // ── PURCHASE ORDERS ───────────────────────────────────────────────────

  f.get("/v1/purchase-orders", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const r = await pool.query(`
      SELECT po.id, po.number, po.department, po.order_date::text, po.expected_delivery::text,
             po.status, po.total_gross, s.name AS supplier_name, u.display_name AS created_by_name
      FROM purchase_order po
      JOIN supplier s ON s.id = po.supplier_id
      JOIN app_user u ON u.id = po.created_by
      WHERE po.property_id=$1 ORDER BY po.order_date DESC LIMIT 100`, [a.propertyId]);
    return { items: r.rows };
  });

  f.post("/v1/purchase-orders", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.update", reply)) return;
    const { supplier_id, department, requisition_id, expected_delivery, notes, items } = req.body ?? {};
    if (!supplier_id || !department || !items?.length) return reply.code(422).send(problem(422, "validation", "supplier_id, department and items required"));
    const year = new Date().getFullYear();
    const seq = (await pool.query(`SELECT nextval('po_seq') AS n`)).rows[0].n;
    const number = `PO-${year}-${String(seq).padStart(4, "0")}`;
    let totalGross = 0;
    for (const i of items) totalGross += (i.quantity ?? 1) * (i.unit_price ?? 0) * (1 + (i.vat_rate ?? 20) / 100);
    const po = (await pool.query(`INSERT INTO purchase_order (tenant_id, property_id, number, supplier_id, department, requisition_id, expected_delivery, notes, total_gross, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [a.tenantId, a.propertyId, number, supplier_id, department, requisition_id ?? null, expected_delivery ?? null, notes ?? null, totalGross, a.userId])).rows[0];
    for (const item of items) {
      await pool.query(`INSERT INTO po_item (po_id, description, quantity_ordered, unit, unit_price, vat_rate) VALUES ($1,$2,$3,$4,$5,$6)`,
        [po.id, item.description, item.quantity ?? 1, item.unit ?? null, item.unit_price ?? 0, item.vat_rate ?? 20]);
    }
    return { id: po.id, number };
  });

  f.post<{ Params: { id: string } }>("/v1/purchase-orders/:id/deliver", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    await pool.query(`UPDATE purchase_order SET status='delivered' WHERE id=$1 AND property_id=$2`, [req.params.id, a.propertyId]);
    if (req.body?.items) {
      for (const item of req.body.items) {
        await pool.query(`UPDATE po_item SET quantity_received=$2, quality_ok=$3, received_at=now() WHERE id=$1`,
          [item.id, item.quantity_received, item.quality_ok ?? true]);
      }
    }
    return { ok: true };
  });

  // ── SUPPLIER INVOICES (3-way match) ───────────────────────────────────

  f.post("/v1/supplier-invoices", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.update", reply)) return;
    const { po_id, supplier_id, invoice_number, invoice_date, due_date, total_net, total_vat, total_gross, notes } = req.body ?? {};
    if (!supplier_id || !invoice_number || !total_gross) return reply.code(422).send(problem(422, "validation", "supplier_id, invoice_number and total_gross required"));
    // 3-way match check
    let matchStatus = "no_po";
    if (po_id) {
      const po = (await pool.query(`SELECT total_gross FROM purchase_order WHERE id=$1`, [po_id])).rows[0];
      if (po) {
        const variance = Math.abs(Number(total_gross) - Number(po.total_gross));
        matchStatus = variance < 0.01 ? "3way_ok" : "price_variance";
      }
    }
    const r = (await pool.query(`INSERT INTO supplier_invoice (tenant_id, property_id, po_id, supplier_id, invoice_number, invoice_date, due_date, total_net, total_vat, total_gross, match_status, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [a.tenantId, a.propertyId, po_id ?? null, supplier_id, invoice_number, invoice_date, due_date ?? null, total_net ?? null, total_vat ?? 0, total_gross, matchStatus, notes ?? null])).rows[0];
    return { id: r.id, match_status: matchStatus };
  });

  f.get("/v1/supplier-invoices", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const r = await pool.query(`
      SELECT si.id, si.invoice_number, si.invoice_date::text, si.due_date::text, si.total_gross,
             si.status, si.match_status, s.name AS supplier_name, po.number AS po_number
      FROM supplier_invoice si JOIN supplier s ON s.id = si.supplier_id
      LEFT JOIN purchase_order po ON po.id = si.po_id
      WHERE si.property_id=$1 ORDER BY si.invoice_date DESC LIMIT 100`, [a.propertyId]);
    return { items: r.rows };
  });
}
