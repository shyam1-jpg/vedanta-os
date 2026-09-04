/**
 * HR & Rota — shifts, clock-in/out, holiday/absence, training records, staff documents.
 */
import type { FastifyInstance } from "fastify";
import { pool, tx } from "./db.ts";
import { requireActor, allow, problem } from "./auth.ts";

export default async function hr(f: FastifyInstance) {

  // ── ROTA ──────────────────────────────────────────────────────────────

  f.get("/v1/rota", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const { from, to, department, user_id } = req.query ?? {};
    const r = await pool.query(`
      SELECT rs.id, rs.shift_date::text, rs.start_time::text, rs.end_time::text,
             rs.department, rs.status, rs.notes, rs.break_minutes,
             u.display_name, u.email
      FROM rota_shift rs JOIN app_user u ON u.id = rs.user_id
      WHERE rs.property_id = $1
        AND ($2::date IS NULL OR rs.shift_date >= $2::date)
        AND ($3::date IS NULL OR rs.shift_date <= $3::date)
        AND ($4::text IS NULL OR rs.department = $4)
        AND ($5::uuid IS NULL OR rs.user_id = $5::uuid)
      ORDER BY rs.shift_date, rs.start_time, u.display_name`,
      [a.propertyId, from ?? null, to ?? null, department ?? null, user_id ?? null]);
    return { items: r.rows };
  });

  f.post("/v1/rota", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "clock.manage", reply)) return;
    const { user_id, department, shift_date, start_time, end_time, break_minutes, notes } = req.body ?? {};
    if (!user_id || !department || !shift_date || !start_time || !end_time)
      return reply.code(422).send(problem(422, "validation", "user_id, department, shift_date, start_time and end_time are required"));
    const r = (await pool.query(`
      INSERT INTO rota_shift (tenant_id, property_id, user_id, department, shift_date, start_time, end_time, break_minutes, notes, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [a.tenantId, a.propertyId, user_id, department, shift_date, start_time, end_time, break_minutes ?? 30, notes ?? null, a.userId])).rows[0];
    return { id: r.id };
  });

  f.delete<{ Params: { id: string } }>("/v1/rota/:id", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "clock.manage", reply)) return;
    await pool.query(`DELETE FROM rota_shift WHERE id=$1 AND property_id=$2`, [req.params.id, a.propertyId]);
    return { ok: true };
  });

  // ── CLOCK IN/OUT ──────────────────────────────────────────────────────

  f.post("/v1/clock/in", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const existing = (await pool.query(`SELECT id FROM clock_record WHERE user_id=$1 AND clocked_out_at IS NULL`, [a.userId])).rows[0];
    if (existing) return reply.code(409).send(problem(409, "already_clocked_in", "You are already clocked in"));
    const r = (await pool.query(`INSERT INTO clock_record (tenant_id, property_id, user_id, shift_id) VALUES ($1,$2,$3,$4) RETURNING id, clocked_in_at`,
      [a.tenantId, a.propertyId, a.userId, (req.body as any)?.shift_id ?? null])).rows[0];
    return { id: r.id, clocked_in_at: r.clocked_in_at };
  });

  f.post("/v1/clock/out", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const r = await pool.query(`UPDATE clock_record SET clocked_out_at=now(), notes=$2 WHERE user_id=$1 AND clocked_out_at IS NULL RETURNING id, clocked_in_at, clocked_out_at`,
      [a.userId, (req.body as any)?.notes ?? null]);
    if (!r.rowCount) return reply.code(404).send(problem(404, "not_clocked_in", "You are not currently clocked in"));
    return r.rows[0];
  });

  f.get("/v1/clock/status", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const r = (await pool.query(`SELECT id, clocked_in_at, shift_id FROM clock_record WHERE user_id=$1 AND clocked_out_at IS NULL`, [a.userId])).rows[0];
    return { clocked_in: !!r, record: r ?? null };
  });

  f.get("/v1/clock/records", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const canManage = a.perms.has("clock.manage");
    const userId = canManage && req.query?.user_id ? req.query.user_id : a.userId;
    const r = await pool.query(`
      SELECT cr.id, cr.clocked_in_at, cr.clocked_out_at, cr.break_minutes, cr.notes,
             cr.approved_at, u.display_name,
             extract(epoch from (coalesce(cr.clocked_out_at, now()) - cr.clocked_in_at))/3600 - (cr.break_minutes::float/60) AS hours_worked
      FROM clock_record cr JOIN app_user u ON u.id = cr.user_id
      WHERE cr.property_id = $1 AND cr.user_id = $2
      ORDER BY cr.clocked_in_at DESC LIMIT 50`, [a.propertyId, userId]);
    return { items: r.rows };
  });

  // ── ABSENCE / HOLIDAY ─────────────────────────────────────────────────

  f.get("/v1/absence", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const canManage = a.perms.has("clock.manage");
    const userId = canManage && req.query?.user_id ? req.query.user_id : a.userId;
    const r = await pool.query(`
      SELECT ar.id, ar.kind, ar.from_date::text, ar.to_date::text, ar.days, ar.status, ar.notes, ar.decline_reason,
             u.display_name, approver.display_name AS approver_name, ar.created_at
      FROM absence_request ar JOIN app_user u ON u.id = ar.user_id
      LEFT JOIN app_user approver ON approver.id = ar.approved_by
      WHERE ar.property_id = $1 ${canManage ? "" : "AND ar.user_id = $2"}
      ORDER BY ar.from_date DESC LIMIT 100`,
      canManage ? [a.propertyId] : [a.propertyId, userId]);
    return { items: r.rows };
  });

  f.post("/v1/absence", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const { kind, from_date, to_date, days, notes } = req.body ?? {};
    if (!from_date || !to_date) return reply.code(422).send(problem(422, "validation", "from_date and to_date required"));
    const r = (await pool.query(`INSERT INTO absence_request (tenant_id, property_id, user_id, kind, from_date, to_date, days, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [a.tenantId, a.propertyId, a.userId, kind ?? "holiday", from_date, to_date, days ?? null, notes ?? null])).rows[0];
    return { id: r.id };
  });

  f.post<{ Params: { id: string } }>("/v1/absence/:id/approve", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "clock.manage", reply)) return;
    await pool.query(`UPDATE absence_request SET status='approved', approved_by=$2, approved_at=now() WHERE id=$1 AND property_id=$3`, [req.params.id, a.userId, a.propertyId]);
    return { ok: true };
  });

  f.post<{ Params: { id: string } }>("/v1/absence/:id/decline", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "clock.manage", reply)) return;
    await pool.query(`UPDATE absence_request SET status='declined', approved_by=$2, approved_at=now(), decline_reason=$3 WHERE id=$1 AND property_id=$4`,
      [req.params.id, a.userId, req.body?.reason ?? null, a.propertyId]);
    return { ok: true };
  });

  // ── TRAINING & QUALIFICATIONS ─────────────────────────────────────────

  f.get("/v1/training", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const userId = req.query?.user_id ?? a.userId;
    const r = await pool.query(`
      SELECT id, title, kind, completed_at::text, expires_at::text, certificate_ref, notes,
             CASE WHEN expires_at < current_date THEN 'expired'
                  WHEN expires_at < current_date + 30 THEN 'expiring_soon'
                  ELSE 'valid' END AS cert_status
      FROM training_record WHERE user_id=$1 AND property_id=$2 ORDER BY completed_at DESC`,
      [userId, a.propertyId]);
    return { items: r.rows };
  });

  f.get("/v1/training/expiring", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "clock.manage", reply)) return;
    const r = await pool.query(`
      SELECT tr.id, tr.title, tr.expires_at::text, u.display_name, u.email
      FROM training_record tr JOIN app_user u ON u.id = tr.user_id
      WHERE tr.property_id=$1 AND tr.expires_at IS NOT NULL AND tr.expires_at < current_date + 60
      ORDER BY tr.expires_at`, [a.propertyId]);
    return { items: r.rows };
  });

  f.post("/v1/training", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "clock.manage", reply)) return;
    const { user_id, title, kind, completed_at, expires_at, certificate_ref, notes } = req.body ?? {};
    if (!user_id || !title) return reply.code(422).send(problem(422, "validation", "user_id and title required"));
    const r = (await pool.query(`INSERT INTO training_record (tenant_id, property_id, user_id, title, kind, completed_at, expires_at, certificate_ref, notes, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [a.tenantId, a.propertyId, user_id, title, kind ?? "internal", completed_at ?? null, expires_at ?? null, certificate_ref ?? null, notes ?? null, a.userId])).rows[0];
    return { id: r.id };
  });

  // ── LABOUR FORECAST ───────────────────────────────────────────────────

  f.get("/v1/labour/forecast", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "clock.manage", reply)) return;
    const { from, to } = req.query ?? {};
    // Scheduled hours per dept per day from rota
    const rota = await pool.query(`
      SELECT rs.shift_date::text, rs.department,
             count(*) AS shifts,
             sum(extract(epoch from (rs.end_time - rs.start_time))/3600 - rs.break_minutes::float/60) AS scheduled_hours
      FROM rota_shift rs WHERE rs.property_id=$1 AND rs.status != 'cancelled'
        AND ($2::date IS NULL OR rs.shift_date >= $2::date)
        AND ($3::date IS NULL OR rs.shift_date <= $3::date)
      GROUP BY rs.shift_date, rs.department ORDER BY rs.shift_date, rs.department`,
      [a.propertyId, from ?? null, to ?? null]);
    // Expected covers and guests for occupancy-based guidance
    const occupancy = await pool.query(`
      SELECT g.arrival_date::text, g.departure_date::text, sum(g.expected_guests) AS guests
      FROM booking_group g WHERE g.property_id=$1 AND g.status IN ('CONFIRMED','IN_HOUSE')
        AND ($2::date IS NULL OR g.departure_date >= $2::date)
        AND ($3::date IS NULL OR g.arrival_date <= $3::date)
      GROUP BY g.arrival_date, g.departure_date`,
      [a.propertyId, from ?? null, to ?? null]);
    return { rota: rota.rows, occupancy: occupancy.rows };
  });
}
