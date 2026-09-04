/**
 * Payments and folio — deposits, balance due, refunds, invoices, receipts.
 * Linked to booking_group (group stays) via group_id or guest_enquiry via enquiry_id.
 */
import type { FastifyInstance } from "fastify";
import { pool, tx } from "./db.ts";
import { requireActor, allow, problem } from "./auth.ts";
import { audit } from "./groups.ts";

function gbp(n: number | null) {
  if (n == null) return null;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 }).format(n);
}

export default async function folio(f: FastifyInstance) {

  // Get or create folio for a booking group
  f.get<{ Params: { id: string } }>("/v1/groups/:id/folio", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.read", reply)) return;
    const g = (await pool.query(`SELECT id, name, expected_guests, price_notes FROM booking_group WHERE id=$1 AND property_id=$2`, [req.params.id, a.propertyId])).rows[0];
    if (!g) return reply.code(404).send(problem(404, "not_found", "Booking not found"));
    let f_row = (await pool.query(`SELECT * FROM folio WHERE group_id=$1`, [g.id])).rows[0];
    if (!f_row) {
      f_row = (await pool.query(`INSERT INTO folio (tenant_id, property_id, group_id, currency) VALUES ($1,$2,$3,'GBP') RETURNING *`,
        [a.tenantId, a.propertyId, g.id])).rows[0];
    }
    const payments = (await pool.query(`SELECT * FROM payment WHERE folio_id=$1 ORDER BY created_at`, [f_row.id])).rows;
    const invoices = (await pool.query(`SELECT * FROM invoice WHERE folio_id=$1 ORDER BY created_at`, [f_row.id])).rows;
    return {
      id: f_row.id,
      group_id: g.id,
      group_name: g.name,
      currency: f_row.currency,
      total_agreed: f_row.total_agreed ? Number(f_row.total_agreed) : null,
      total_agreed_fmt: gbp(f_row.total_agreed ? Number(f_row.total_agreed) : null),
      total_paid: Number(f_row.total_paid ?? 0),
      total_paid_fmt: gbp(Number(f_row.total_paid ?? 0)),
      total_refunded: Number(f_row.total_refunded ?? 0),
      balance_due: Number(f_row.balance_due ?? 0),
      balance_due_fmt: gbp(Number(f_row.balance_due ?? 0)),
      status: f_row.status,
      notes: f_row.notes,
      payments: payments.map(p => ({
        id: p.id, kind: p.kind, method: p.method,
        amount: Number(p.amount), amount_fmt: gbp(Number(p.amount)),
        reference: p.reference, note: p.note,
        due_date: p.due_date, paid_at: p.paid_at, created_at: p.created_at,
      })),
      invoices: invoices.map(i => ({
        id: i.id, number: i.number, kind: i.kind,
        amount: Number(i.amount), amount_fmt: gbp(Number(i.amount)),
        issued_at: i.issued_at, due_date: i.due_date, sent_at: i.sent_at,
      })),
    };
  });

  // Set agreed total on a folio
  f.patch<{ Params: { id: string } }>("/v1/groups/:id/folio", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.update", reply)) return;
    const g = (await pool.query(`SELECT id FROM booking_group WHERE id=$1 AND property_id=$2`, [req.params.id, a.propertyId])).rows[0];
    if (!g) return reply.code(404).send(problem(404, "not_found", "Booking not found"));
    let f_row = (await pool.query(`SELECT id FROM folio WHERE group_id=$1`, [g.id])).rows[0];
    if (!f_row) f_row = (await pool.query(`INSERT INTO folio (tenant_id, property_id, group_id, currency) VALUES ($1,$2,$3,'GBP') RETURNING id`, [a.tenantId, a.propertyId, g.id])).rows[0];
    const { total_agreed, notes } = req.body ?? {};
    await pool.query(`UPDATE folio SET total_agreed=coalesce($2::numeric, total_agreed), notes=coalesce($3, notes), updated_at=now() WHERE id=$1`,
      [f_row.id, total_agreed ?? null, notes ?? null]);
    return { ok: true };
  });

  // Record a payment
  f.post<{ Params: { id: string } }>("/v1/groups/:id/folio/payments", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.update", reply)) return;
    const g = (await pool.query(`SELECT id FROM booking_group WHERE id=$1 AND property_id=$2`, [req.params.id, a.propertyId])).rows[0];
    if (!g) return reply.code(404).send(problem(404, "not_found", "Booking not found"));
    const { kind, method, amount, reference, note, due_date, paid_at } = req.body ?? {};
    if (!kind || !amount || isNaN(Number(amount))) return reply.code(422).send(problem(422, "validation", "kind and amount are required"));
    return tx(async c => {
      let f_row = (await c.query(`SELECT id FROM folio WHERE group_id=$1`, [g.id])).rows[0];
      if (!f_row) f_row = (await c.query(`INSERT INTO folio (tenant_id, property_id, group_id, currency) VALUES ($1,$2,$3,'GBP') RETURNING id`, [a.tenantId, a.propertyId, g.id])).rows[0];
      const p = (await c.query(`INSERT INTO payment (tenant_id, folio_id, kind, method, amount, reference, note, due_date, paid_at, recorded_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [a.tenantId, f_row.id, kind, method ?? null, Number(amount), reference ?? null, note ?? null,
         due_date ?? null, paid_at ?? null, a.userId])).rows[0];
      await audit(c, a, "folio", f_row.id, "payment.recorded", { payload: { kind, amount: Number(amount), method, reference } });
      return { id: p.id, folio_id: f_row.id };
    });
  });

  // Mark a payment as received (set paid_at)
  f.post<{ Params: { id: string; paymentId: string } }>("/v1/groups/:id/folio/payments/:paymentId/receive", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.update", reply)) return;
    const r = await pool.query(`
      UPDATE payment p SET paid_at = now()
      FROM folio f JOIN booking_group g ON g.id = f.group_id
      WHERE p.id = $1 AND f.id = p.folio_id AND g.property_id = $2 AND p.paid_at IS NULL
      RETURNING p.id`, [req.params.paymentId, a.propertyId]);
    if (!r.rowCount) return reply.code(404).send(problem(404, "not_found", "Payment not found or already received"));
    return { received: req.params.paymentId };
  });

  // Issue an invoice
  f.post<{ Params: { id: string } }>("/v1/groups/:id/folio/invoices", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.update", reply)) return;
    const g = (await pool.query(`SELECT id FROM booking_group WHERE id=$1 AND property_id=$2`, [req.params.id, a.propertyId])).rows[0];
    if (!g) return reply.code(404).send(problem(404, "not_found", "Booking not found"));
    const { kind, amount, due_date } = req.body ?? {};
    if (!amount || isNaN(Number(amount))) return reply.code(422).send(problem(422, "validation", "amount is required"));
    return tx(async c => {
      let f_row = (await c.query(`SELECT id FROM folio WHERE group_id=$1`, [g.id])).rows[0];
      if (!f_row) f_row = (await c.query(`INSERT INTO folio (tenant_id, property_id, group_id, currency) VALUES ($1,$2,$3,'GBP') RETURNING id`, [a.tenantId, a.propertyId, g.id])).rows[0];
      const year = new Date().getFullYear();
      const seq = (await c.query(`SELECT nextval('invoice_seq') AS n`)).rows[0].n;
      const number = `VOR-${year}-${String(seq).padStart(4, "0")}`;
      const inv = (await c.query(`INSERT INTO invoice (tenant_id, folio_id, number, kind, amount, due_date, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, number`,
        [a.tenantId, f_row.id, number, kind ?? "invoice", Number(amount), due_date ?? null, a.userId])).rows[0];
      return { id: inv.id, number: inv.number, folio_id: f_row.id };
    });
  });

  // House Pulse: total payments due across all open folios (replaces the hardcoded null)
  f.get("/v1/estate/payments-due", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.read", reply)) return;
    const r = await pool.query(`
      SELECT
        count(*) filter (where balance_due > 0)::int AS folios_with_balance,
        coalesce(sum(balance_due) filter (where balance_due > 0), 0) AS total_due,
        coalesce(sum(balance_due) filter (where balance_due > 0 AND f.status = 'open'
          AND EXISTS (SELECT 1 FROM booking_group g WHERE g.id=f.group_id AND g.status IN ('CONFIRMED','IN_HOUSE'))), 0) AS overdue
      FROM folio f WHERE f.property_id = $1`, [a.propertyId]);
    const row = r.rows[0];
    return {
      folios_with_balance: row.folios_with_balance,
      total_due: Number(row.total_due),
      total_due_fmt: gbp(Number(row.total_due)),
      overdue: Number(row.overdue),
      overdue_fmt: gbp(Number(row.overdue)),
    };
  });
}
