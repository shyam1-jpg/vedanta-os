/**
 * Staff sign-in is Microsoft 365 / OpenID Connect, with multi-factor authentication
 * checked on the token. There is no email-only staff sign-in and no X-User header.
 *
 * Local development can use POST /auth/dev-login. That route refuses to run when
 * NODE_ENV is production, when the database looks hosted, or when the dev secret
 * and flag are missing. It only accepts synthetic @example.invalid accounts.
 *
 * Guest access-code sign-in is a separate flag (emailLoginEnabled). It is not staff login.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { pool } from "./db.ts";

function truthy(v: string | undefined): boolean {
  if (v == null) return false;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}

/** Guest registration / email+code sign-in feature flag. Enabled by default. */
export function emailLoginEnabled(): boolean {
  const v = process.env.GUEST_PORTAL_ENABLED;
  return v == null ? true : truthy(v);
}

/** The X-User header is never a credential. */
export function acceptsIdentityHeader(): boolean {
  return false;
}

export function devLoginAllowed(): { ok: boolean; reason: string } {
  if (process.env.NODE_ENV === "production") return { ok: false, reason: "production" };
  const db = process.env.DATABASE_URL ?? "";
  if (/render\.com|neon\.tech|amazonaws\.com|supabase\.co/i.test(db)) return { ok: false, reason: "hosted-database" };
  if (process.env.ALLOW_DEV_LOGIN !== "true") return { ok: false, reason: "flag" };
  if ((process.env.DEV_LOGIN_SECRET ?? "").length < 16) return { ok: false, reason: "secret" };
  return { ok: true, reason: "ok" };
}

export function devLoginEmailAllowed(email: string): boolean {
  return email.trim().toLowerCase().endsWith("@example.invalid");
}

function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

function configuredOwnerEmails(): Set<string> {
  const values = [
    process.env.BOOTSTRAP_OWNER_EMAIL,
    ...(process.env.BOOTSTRAP_ADMIN_EMAILS ?? "").split(","),
    ...(process.env.SYSTEM_OWNER_ALLOWLIST ?? "").split(","),
  ];
  return new Set(values.map(x => x?.trim().toLowerCase()).filter(Boolean) as string[]);
}

/** Production SYSTEM_OWNER privilege requires an explicit deployment allowlist. */
export function productionOwnerAllowed(email: string): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return configuredOwnerEmails().has(email.trim().toLowerCase());
}

export type Audience = "ADMIN" | "STAFF";
export type Actor = { userId: string; tenantId: string; propertyId: string; email: string; name: string; role: string; roleName: string; department: string | null; perms: Set<string>; audience: Audience; propertyName?: string | null; propertyKicker?: string | null };

const loginHits = new Map<string, { n: number; t: number }>();
function rateOk(key: string, max = 8, windowMs = 60_000): boolean {
  const now = Date.now();
  const cur = loginHits.get(key);
  if (!cur || now - cur.t > windowMs) { loginHits.set(key, { n: 1, t: now }); return true; }
  cur.n += 1;
  return cur.n <= max;
}

export function problem(status: number, code: string, detail: string, extra: object = {}) {
  return { status, code, title: code.replace(/_/g, " "), detail, ...extra };
}

export async function issueStaffSession(userId: string, propertyId: string, audience: Audience): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    `insert into session (token, user_id, property_id, audience, expires_at) values ($1,$2,$3,$4, now() + interval '8 hours')`,
    [token, userId, propertyId, audience],
  );
  return token;
}

async function loadActor(where: string, param: string): Promise<Actor | null> {
  const { rows } = await pool.query(`
    select u.id user_id, u.tenant_id, u.email, u.display_name, m.property_id, r.code role, r.name role_name, d.code department,
           p.name property_name,
           coalesce(p.settings->>'kicker', 'Retreat Center') property_kicker,
           coalesce(array_agg(rp.permission_code) filter (where rp.permission_code is not null), '{}') perms
    from app_user u join membership m on m.user_id = u.id join role r on r.id = m.role_id
    left join department d on d.id = m.department_id
    left join role_permission rp on rp.role_id = r.id
    left join property p on p.id = m.property_id
    ${where} and u.status = 'ACTIVE'
    group by u.id, m.property_id, r.code, r.name, d.code, p.name, p.settings limit 1`, [param]);
  const r = rows[0]; if (!r) return null;
  if (r.role === "SYSTEM_OWNER" && !productionOwnerAllowed(r.email)) return null;
  return { userId: r.user_id, tenantId: r.tenant_id, propertyId: r.property_id, email: r.email, name: r.display_name, role: r.role, roleName: r.role_name, department: r.department ?? null, perms: new Set(r.perms), audience: "ADMIN", propertyName: r.property_name ?? null, propertyKicker: r.property_kicker ?? null };
}

export async function requireActor(req: FastifyRequest, reply: FastifyReply, audience: Audience | Audience[] = "ADMIN"): Promise<Actor | null> {
  const want = Array.isArray(audience) ? audience : [audience];
  const auth = req.headers.authorization;
  let a: Actor | null = null;
  let sessAudience: Audience | null = null;
  if (auth?.startsWith("Bearer ")) {
    const tok = auth.slice(7);
    const s = (await pool.query(`select user_id, audience from session where token=$1 and expires_at > now()`, [tok])).rows[0];
    if (s) { a = await loadActor("where u.id = $1", s.user_id); sessAudience = s.audience; }
  }
  if (!a || !sessAudience || !want.includes(sessAudience)) { reply.code(401).send(problem(401, "unauthenticated", "Sign in to continue")); return null; }
  a.audience = sessAudience;
  return a;
}

export function allow(a: Actor, perm: string, reply: FastifyReply): boolean {
  if (a.perms.has(perm)) return true;
  reply.code(403).send(problem(403, "forbidden", `Your role (${a.role.replace(/_/g, " ").toLowerCase()}) cannot ${perm.replace(".", " ")}`));
  return false;
}

export default async function authRoutes(f: FastifyInstance) {
  f.post<{ Body: { secret?: string } }>("/auth/dev-users", async (req, reply) => {
    const gate = devLoginAllowed();
    if (!gate.ok) return reply.code(404).send(problem(404, "not_found", "Development sign-in is not available"));
    if (!secretMatches(String(req.body?.secret ?? ""), process.env.DEV_LOGIN_SECRET ?? "")) {
      return reply.code(401).send(problem(401, "sign_in_failed", "Development sign-in was not recognised"));
    }
    const { rows } = await pool.query(
      `select u.email, u.display_name name, r.name role from app_user u
       join membership m on m.user_id=u.id join role r on r.id=m.role_id
       where u.status='ACTIVE' and lower(u.email) like '%@example.invalid'
       order by r.code, u.display_name`,
    );
    return { items: rows };
  });

  f.post<{ Body: { email?: string; secret?: string; surface?: string } }>("/auth/dev-login", async (req, reply) => {
    const gate = devLoginAllowed();
    if (!gate.ok) return reply.code(404).send(problem(404, "not_found", "Development sign-in is not available"));
    const ip = req.ip || "local";
    if (!rateOk(`dev:${ip}`)) return reply.code(429).send(problem(429, "rate_limited", "Too many sign-in attempts. Wait a minute."));
    if (!secretMatches(String(req.body?.secret ?? ""), process.env.DEV_LOGIN_SECRET ?? "")) {
      return reply.code(401).send(problem(401, "sign_in_failed", "Development sign-in was not recognised"));
    }
    const email = req.body?.email?.trim().toLowerCase() ?? "";
    if (!devLoginEmailAllowed(email)) {
      return reply.code(401).send(problem(401, "sign_in_failed", "Development sign-in only opens synthetic example accounts"));
    }
    const surface = (req.body?.surface === "staff" ? "STAFF" : "ADMIN") as Audience;
    const a = await loadActor("where lower(u.email) = $1", email);
    if (!a) return reply.code(401).send(problem(401, "sign_in_failed", "Sign-in was not recognised"));
    const token = await issueStaffSession(a.userId, a.propertyId, surface);
    a.audience = surface;
    return { token, user: { email: a.email, name: a.name, role: a.role, role_name: a.roleName, department: a.department, permissions: [...a.perms], surface } };
  });

  f.post("/auth/logout", async (req, reply) => {
    const auth = req.headers.authorization; if (auth?.startsWith("Bearer ")) await pool.query(`delete from session where token=$1`, [auth.slice(7)]);
    return reply.code(204).send();
  });
  f.get("/me", async (req, reply) => { const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a) return; return { email: a.email, name: a.name, role: a.role, role_name: a.roleName, department: a.department, permissions: [...a.perms], surface: a.audience, property_name: a.propertyName ?? null, property_kicker: a.propertyKicker ?? null }; });
}
