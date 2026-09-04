/**
 * Session management — list active sessions, revoke one, revoke all (force logout all devices),
 * sign-in history. Staff can see their own sessions; managers can see any user's sessions.
 */
import type { FastifyInstance } from "fastify";
import { pool } from "./db.ts";
import { requireActor, allow, problem } from "./auth.ts";

function deviceLabel(userAgent: string | undefined): string {
  if (!userAgent) return "Unknown device";
  if (/iPhone|iPad/.test(userAgent)) return "iPhone / iPad";
  if (/Android/.test(userAgent)) return "Android";
  if (/Windows/.test(userAgent)) return userAgent.includes("Chrome") ? "Chrome on Windows" : "Windows browser";
  if (/Mac/.test(userAgent)) return userAgent.includes("Chrome") ? "Chrome on Mac" : "Safari on Mac";
  if (/Linux/.test(userAgent)) return "Linux browser";
  return "Browser";
}

export default async function sessions(f: FastifyInstance) {

  // List my active sessions
  f.get("/v1/me/sessions", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const r = await pool.query(`
      SELECT id, device_label, ip_address, last_seen_at, created_at,
             token = $2 AS is_current
      FROM session
      WHERE user_id = $1 AND expires_at > now() AND revoked_at IS NULL
      ORDER BY last_seen_at DESC`, [a.userId, req.headers.authorization?.slice(7) ?? ""]);
    return { items: r.rows };
  });

  // Revoke a specific session (logout one device)
  f.delete<{ Params: { id: string } }>("/v1/me/sessions/:id", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const r = await pool.query(`
      UPDATE session SET revoked_at = now()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
      RETURNING id`, [req.params.id, a.userId]);
    if (!r.rowCount) return reply.code(404).send(problem(404, "not_found", "Session not found"));
    return { revoked: req.params.id };
  });

  // Revoke ALL sessions (force logout everywhere)
  f.post("/v1/me/sessions/revoke-all", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const r = await pool.query(`
      UPDATE session SET revoked_at = now()
      WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
      RETURNING id`, [a.userId]);
    return { revoked: r.rowCount ?? 0 };
  });

  // Sign-in history (my own)
  f.get("/v1/me/sign-in-history", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    const r = await pool.query(`
      SELECT provider, ip_address, device_label, success, failure_reason, created_at
      FROM sign_in_event
      WHERE user_id = $1
      ORDER BY created_at DESC LIMIT 50`, [a.userId]);
    return { items: r.rows };
  });

  // Manager: list all active sessions for a user
  f.get<{ Params: { userId: string } }>("/v1/users/:userId/sessions", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "user.manage", reply)) return;
    const r = await pool.query(`
      SELECT s.id, s.device_label, s.ip_address, s.last_seen_at, s.created_at,
             u.display_name, u.email
      FROM session s JOIN app_user u ON u.id = s.user_id
      WHERE s.user_id = $1 AND s.property_id = $2
        AND s.expires_at > now() AND s.revoked_at IS NULL
      ORDER BY s.last_seen_at DESC`, [req.params.userId, a.propertyId]);
    return { items: r.rows };
  });

  // Manager: force logout a specific user from all devices
  f.post<{ Params: { userId: string } }>("/v1/users/:userId/sessions/revoke-all", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "user.manage", reply)) return;
    const r = await pool.query(`
      UPDATE session SET revoked_at = now()
      WHERE user_id = $1 AND property_id = $2
        AND revoked_at IS NULL AND expires_at > now()
      RETURNING id`, [req.params.userId, a.propertyId]);
    return { revoked: r.rowCount ?? 0 };
  });

  // Manager: full sign-in audit for the property
  f.get("/v1/sign-in-audit", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "user.manage", reply)) return;
    const limit = Math.min(Number(req.query?.limit ?? 100), 500);
    const r = await pool.query(`
      SELECT e.provider, e.ip_address, e.device_label, e.success, e.failure_reason,
             e.created_at, u.display_name, u.email
      FROM sign_in_event e
      JOIN app_user u ON u.id = e.user_id
      WHERE e.property_id = $1
      ORDER BY e.created_at DESC LIMIT $2`, [a.propertyId, limit]);
    return { items: r.rows };
  });
}

// Helper called from auth.ts and microsoft.ts to record sign-in events and device info
export async function recordSignIn(opts: {
  tenantId: string; userId: string; propertyId: string;
  provider: string; token: string;
  req: { headers: Record<string, string | string[] | undefined>; ip?: string };
  success: boolean; failureReason?: string;
}) {
  const ua = String(opts.req.headers["user-agent"] ?? "");
  const ip = opts.req.ip ?? String(opts.req.headers["x-forwarded-for"] ?? "");
  const label = deviceLabel(ua);
  // Record sign-in event
  await pool.query(`
    INSERT INTO sign_in_event (tenant_id, user_id, property_id, provider, ip_address, user_agent, device_label, success, failure_reason)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [opts.tenantId, opts.userId, opts.propertyId, opts.provider, ip || null, ua || null, label, opts.success, opts.failureReason ?? null]);
  // Stamp device info onto the session
  if (opts.success) {
    await pool.query(`
      UPDATE session SET device_label=$2, ip_address=$3, user_agent=$4, last_seen_at=now()
      WHERE token=$1`,
      [opts.token, label, ip || null, ua || null]);
  }
}
