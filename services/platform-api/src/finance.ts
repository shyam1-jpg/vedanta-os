/**
 * Finance dashboard — revenue, food cost, labour cost, occupancy, ADR, RevPAR, budget variance.
 * Reads from finance_monthly and purchasing_monthly views built in migration 0032.
 */
import type { FastifyInstance } from "fastify";
import { pool } from "./db.ts";
import { requireActor, allow, problem } from "./auth.ts";

export default async function finance(f: FastifyInstance) {

  // Monthly finance summary
  f.get("/v1/finance/summary", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "report.read", reply)) return;
    const { year } = req.query ?? {};
    const targetYear = Number(year ?? new Date().getFullYear());

    const [revenue, purchasing, budgets] = await Promise.all([
      pool.query(`SELECT * FROM finance_monthly WHERE property_id=$1 AND extract(year FROM month)=$2 ORDER BY month`, [a.propertyId, targetYear]),
      pool.query(`SELECT * FROM purchasing_monthly WHERE property_id=$1 AND extract(year FROM month)=$2 ORDER BY month, department`, [a.propertyId, targetYear]),
      pool.query(`SELECT * FROM budget WHERE property_id=$1 AND year=$2 ORDER BY month, category`, [a.propertyId, targetYear]),
    ]);

    // Build monthly grid
    const months: Record<string, any> = {};
    for (const r of revenue.rows) {
      const m = r.month.slice(0, 7);
      months[m] = { month: m, ...r, purchasing: {}, budget: {} };
    }
    for (const p of purchasing.rows) {
      const m = p.month.slice(0, 7);
      if (!months[m]) months[m] = { month: m, purchasing: {}, budget: {} };
      months[m].purchasing[p.department] = { orders: p.orders, spend: Number(p.total_spend) };
    }
    for (const b of budgets.rows) {
      const m = `${b.year}-${String(b.month).padStart(2, "0")}`;
      if (!months[m]) months[m] = { month: m, purchasing: {}, budget: {} };
      months[m].budget[b.category] = Number(b.amount);
    }

    // YTD totals
    const allMonths = Object.values(months).sort((a: any, b: any) => a.month.localeCompare(b.month));
    const ytd = {
      revenue_received: allMonths.reduce((s: number, m: any) => s + Number(m.revenue_received ?? 0), 0),
      revenue_agreed: allMonths.reduce((s: number, m: any) => s + Number(m.revenue_agreed ?? 0), 0),
      bookings: allMonths.reduce((s: number, m: any) => s + Number(m.bookings ?? 0), 0),
      guest_nights: allMonths.reduce((s: number, m: any) => s + Number(m.guest_nights ?? 0), 0),
      total_purchasing_spend: purchasing.rows.reduce((s, r) => s + Number(r.total_spend), 0),
    };

    return { months: allMonths, ytd, year: targetYear };
  });

  // Set/update budget targets
  f.post("/v1/finance/budget", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "report.read", reply)) return;
    const { year, month, category, amount, notes } = req.body ?? {};
    if (!year || !month || !category || amount == null) return reply.code(422).send(problem(422, "validation", "year, month, category and amount required"));
    await pool.query(`INSERT INTO budget (tenant_id, property_id, year, month, category, amount, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (property_id, year, month, category) DO UPDATE SET amount=excluded.amount, notes=excluded.notes`,
      [a.tenantId, a.propertyId, year, month, category, amount, notes ?? null, a.userId]);
    return { ok: true };
  });

  // KPI dashboard snapshot (for House Today and reports)
  f.get("/v1/finance/kpi", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "report.read", reply)) return;
    const thisMonth = new Date().toISOString().slice(0, 7);
    const lastYear = new Date().getFullYear() - 1;

    const [current, py, ytd_purchasing] = await Promise.all([
      pool.query(`SELECT * FROM finance_monthly WHERE property_id=$1 AND to_char(month,'YYYY-MM')=$2`, [a.propertyId, thisMonth]),
      pool.query(`SELECT revenue_agreed, occupancy_pct FROM finance_monthly WHERE property_id=$1 AND month = (current_date - interval '1 year')::date`, [a.propertyId]),
      pool.query(`SELECT sum(total_spend) AS spend FROM purchasing_monthly WHERE property_id=$1 AND extract(year FROM month)=extract(year FROM current_date)`, [a.propertyId]),
    ]);

    const cur = current.rows[0] ?? {};
    const pyRow = py.rows[0] ?? {};
    return {
      this_month: thisMonth,
      revenue_received: Number(cur.revenue_received ?? 0),
      revenue_agreed: Number(cur.revenue_agreed ?? 0),
      balance_outstanding: Number(cur.balance_outstanding ?? 0),
      occupancy_pct: cur.occupancy_pct ? Number(cur.occupancy_pct) : null,
      adr: cur.adr ? Number(cur.adr) : null,
      bookings: Number(cur.bookings ?? 0),
      guest_nights: Number(cur.guest_nights ?? 0),
      // Year-on-year
      py_revenue: Number(pyRow.revenue_agreed ?? 0),
      py_occupancy: pyRow.occupancy_pct ? Number(pyRow.occupancy_pct) : null,
      // YTD purchasing
      ytd_purchasing_spend: Number(ytd_purchasing.rows[0]?.spend ?? 0),
    };
  });

  // Sustainability readings
  f.get("/v1/sustainability", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const { from, to, category } = req.query ?? {};
    const r = await pool.query(`
      SELECT reading_date::text, category, value, notes
      FROM sustainability_reading
      WHERE property_id=$1
        AND ($2::date IS NULL OR reading_date >= $2::date)
        AND ($3::date IS NULL OR reading_date <= $3::date)
        AND ($4::text IS NULL OR category=$4)
      ORDER BY reading_date DESC, category`, [a.propertyId, from ?? null, to ?? null, category ?? null]);
    return { items: r.rows };
  });

  f.post("/v1/sustainability", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const { reading_date, category, value, notes } = req.body ?? {};
    if (!reading_date || !category || value == null) return reply.code(422).send(problem(422, "validation", "reading_date, category and value required"));
    const r = (await pool.query(`INSERT INTO sustainability_reading (tenant_id, property_id, reading_date, category, value, notes, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [a.tenantId, a.propertyId, reading_date, category, value, notes ?? null, a.userId])).rows[0];
    return { id: r.id };
  });
}
