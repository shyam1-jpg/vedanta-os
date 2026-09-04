/**
 * Emergency command centre — fire, medical, missing guest, power failure, water leak, evacuation.
 * Compliance evidence — SOP completion, safety checks, sign-off.
 * Asset management — QR codes, service history, warranty tracking.
 */
import type { FastifyInstance } from "fastify";
import { pool } from "./db.ts";
import { requireActor, allow, problem } from "./auth.ts";

export default async function emergency(f: FastifyInstance) {

  // ── EMERGENCY INCIDENTS ───────────────────────────────────────────────

  f.get("/v1/emergencies", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const r = await pool.query(`
      SELECT e.id, e.kind, e.severity, e.title, e.location, e.emergency_services_called,
             e.resolved_at, e.created_at, u.display_name AS reported_by_name
      FROM emergency_incident e JOIN app_user u ON u.id = e.reported_by
      WHERE e.property_id=$1 ORDER BY e.created_at DESC LIMIT 50`, [a.propertyId]);
    return { items: r.rows };
  });

  f.post("/v1/emergencies", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const { kind, severity, title, description, location, persons_involved } = req.body ?? {};
    if (!kind || !title) return reply.code(422).send(problem(422, "validation", "kind and title required"));
    const r = (await pool.query(`INSERT INTO emergency_incident (tenant_id, property_id, kind, severity, title, description, location, persons_involved, reported_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [a.tenantId, a.propertyId, kind, severity ?? "amber", title, description ?? null, location ?? null, persons_involved ?? null, a.userId])).rows[0];
    return { id: r.id };
  });

  f.get<{ Params: { id: string } }>("/v1/emergencies/:id", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const e = (await pool.query(`SELECT * FROM emergency_incident WHERE id=$1 AND property_id=$2`, [req.params.id, a.propertyId])).rows[0];
    if (!e) return reply.code(404).send(problem(404, "not_found", "Incident not found"));
    const actions = (await pool.query(`SELECT ea.*, u.display_name FROM emergency_action ea JOIN app_user u ON u.id=ea.taken_by WHERE ea.incident_id=$1 ORDER BY ea.taken_at`, [req.params.id])).rows;
    return { ...e, actions };
  });

  f.post<{ Params: { id: string } }>("/v1/emergencies/:id/actions", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const { action } = req.body ?? {};
    if (!action) return reply.code(422).send(problem(422, "validation", "action required"));
    const r = (await pool.query(`INSERT INTO emergency_action (incident_id, action, taken_by) VALUES ($1,$2,$3) RETURNING id, taken_at`, [req.params.id, action, a.userId])).rows[0];
    return r;
  });

  f.post<{ Params: { id: string } }>("/v1/emergencies/:id/resolve", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    await pool.query(`UPDATE emergency_incident SET resolved_at=now(), resolution_notes=$2, emergency_services_called=coalesce($3,emergency_services_called), services_called=coalesce($4,services_called) WHERE id=$1 AND property_id=$5`,
      [req.params.id, req.body?.resolution_notes ?? null, req.body?.emergency_services_called ?? null, req.body?.services_called ?? null, a.propertyId]);
    return { ok: true };
  });

  // ── COMPLIANCE ────────────────────────────────────────────────────────

  f.get("/v1/compliance", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const { category } = req.query ?? {};
    const r = await pool.query(`
      SELECT cr.id, cr.category, cr.title, cr.frequency, cr.due_date::text, cr.completed_at,
             cr.passed, cr.failure_notes, cr.corrective_action, cr.approved_at,
             u.display_name AS completed_by_name, approver.display_name AS approved_by_name
      FROM compliance_record cr
      LEFT JOIN app_user u ON u.id=cr.completed_by
      LEFT JOIN app_user approver ON approver.id=cr.approved_by
      WHERE cr.property_id=$1 AND ($2::text IS NULL OR cr.category=$2)
      ORDER BY cr.due_date DESC LIMIT 200`, [a.propertyId, category ?? null]);
    return { items: r.rows };
  });

  f.post("/v1/compliance", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const { category, title, description, frequency, due_date } = req.body ?? {};
    if (!category || !title) return reply.code(422).send(problem(422, "validation", "category and title required"));
    const r = (await pool.query(`INSERT INTO compliance_record (tenant_id, property_id, category, title, description, frequency, due_date) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [a.tenantId, a.propertyId, category, title, description ?? null, frequency ?? null, due_date ?? null])).rows[0];
    return { id: r.id };
  });

  f.post<{ Params: { id: string } }>("/v1/compliance/:id/complete", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const { passed, evidence_notes, failure_notes, corrective_action } = req.body ?? {};
    await pool.query(`UPDATE compliance_record SET completed_at=now(), completed_by=$2, passed=$3, evidence_notes=$4, failure_notes=$5, corrective_action=$6 WHERE id=$1 AND property_id=$7`,
      [req.params.id, a.userId, passed ?? true, evidence_notes ?? null, failure_notes ?? null, corrective_action ?? null, a.propertyId]);
    return { ok: true };
  });

  // ── ASSETS ────────────────────────────────────────────────────────────

  f.get("/v1/assets", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const { category } = req.query ?? {};
    const r = await pool.query(`
      SELECT id, qr_code, name, category, location, manufacturer, model, status,
             next_service_date::text, warranty_expires::text,
             CASE WHEN next_service_date < current_date THEN 'overdue'
                  WHEN next_service_date < current_date + 30 THEN 'due_soon'
                  ELSE 'ok' END AS service_status
      FROM asset WHERE property_id=$1 AND status != 'disposed' AND ($2::text IS NULL OR category=$2)
      ORDER BY name`, [a.propertyId, category ?? null]);
    return { items: r.rows };
  });

  f.get<{ Params: { id: string } }>("/v1/assets/:id", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const asset = (await pool.query(`SELECT * FROM asset WHERE id=$1 AND property_id=$2`, [req.params.id, a.propertyId])).rows[0];
    if (!asset) return reply.code(404).send(problem(404, "not_found", "Asset not found"));
    const history = (await pool.query(`SELECT asr.*, u.display_name FROM asset_service_record asr LEFT JOIN app_user u ON u.id=asr.done_by WHERE asr.asset_id=$1 ORDER BY asr.service_date DESC`, [req.params.id])).rows;
    return { ...asset, service_history: history };
  });

  f.post("/v1/assets", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "maintenance.report", reply)) return;
    const { name, category, location, manufacturer, model, serial_number, purchase_date, purchase_price, warranty_expires, next_service_date, notes } = req.body ?? {};
    if (!name || !category) return reply.code(422).send(problem(422, "validation", "name and category required"));
    // Auto-generate QR code
    const seq = (await pool.query(`SELECT count(*)+1 AS n FROM asset WHERE tenant_id=$1`, [a.tenantId])).rows[0].n;
    const qrCode = `VOR-ASSET-${String(seq).padStart(5, "0")}`;
    const r = (await pool.query(`INSERT INTO asset (tenant_id, property_id, qr_code, name, category, location, manufacturer, model, serial_number, purchase_date, purchase_price, warranty_expires, next_service_date, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id, qr_code`,
      [a.tenantId, a.propertyId, qrCode, name, category, location ?? null, manufacturer ?? null, model ?? null, serial_number ?? null, purchase_date ?? null, purchase_price ?? null, warranty_expires ?? null, next_service_date ?? null, notes ?? null])).rows[0];
    return r;
  });

  f.post<{ Params: { id: string } }>("/v1/assets/:id/service", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const { kind, description, cost, contractor, parts_used, service_date, next_service_date } = req.body ?? {};
    if (!kind || !description || !service_date) return reply.code(422).send(problem(422, "validation", "kind, description and service_date required"));
    await pool.query(`INSERT INTO asset_service_record (asset_id, kind, description, cost, contractor, parts_used, service_date, next_service_date, done_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [req.params.id, kind, description, cost ?? null, contractor ?? null, parts_used ?? null, service_date, next_service_date ?? null, a.userId]);
    if (next_service_date) await pool.query(`UPDATE asset SET last_service_date=$2, next_service_date=$3 WHERE id=$1`, [req.params.id, service_date, next_service_date]);
    return { ok: true };
  });

  // Lookup asset by QR code (for mobile scanning)
  f.get<{ Params: { code: string } }>("/v1/assets/qr/:code", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const r = (await pool.query(`SELECT * FROM asset WHERE qr_code=$1 AND property_id=$2`, [req.params.code, a.propertyId])).rows[0];
    if (!r) return reply.code(404).send(problem(404, "not_found", "Asset not found"));
    return r;
  });
}
