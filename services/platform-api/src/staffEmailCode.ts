/** One-time email verification for existing staff accounts. SMTP is mandatory. */
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";
import type { FastifyInstance } from "fastify";
import { pool } from "./db.ts";
import { loadActor, problem } from "./auth.ts";

export const staffEmailCodeEnabled = () => !!process.env.SMTP_URL;
const requested = new Map<string, { count: number; since: number }>();
function limit(key: string, max: number) {
  const now = Date.now();
  const hit = requested.get(key);
  if (!hit || now - hit.since > 60_000) { requested.set(key, { count: 1, since: now }); return true; }
  return ++hit.count <= max;
}
export function codeHash(code: string, salt: string) { return scryptSync(code, salt, 32).toString("hex"); }
function matches(code: string, salt: string, expected: string) {
  if (!/^\d{8}$/.test(code) || !/^[a-f0-9]{64}$/.test(expected)) return false;
  return timingSafeEqual(Buffer.from(codeHash(code, salt), "hex"), Buffer.from(expected, "hex"));
}

export default async function staffEmailCode(f: FastifyInstance) {
  f.post<{ Body: { email?: string; surface?: string } }>("/auth/email-code/request", async (req, reply) => {
    if (!staffEmailCodeEnabled()) return reply.code(503).send(problem(503, "email_unavailable", "Email sign-in is not configured yet"));
    if (!limit(`request:${req.ip}`, 8)) return reply.code(429).send(problem(429, "rate_limited", "Wait a minute before requesting another code"));
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const surface = req.body?.surface === "staff" ? "STAFF" : "ADMIN";
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply.code(422).send(problem(422, "validation", "Enter a valid staff email"));
    const generic = { message: "If this is an active staff account, a code has been sent. Check your inbox and junk folder." };
    const actor = await loadActor("where lower(u.email) = $1", email);
    if (!actor) return generic;
    const code = String(randomInt(0, 100_000_000)).padStart(8, "0");
    const salt = randomBytes(16).toString("hex");
    const hash = codeHash(code, salt);
    const r = await pool.query(`insert into staff_email_code (user_id, surface, code_hash, salt, expires_at)
      values ($1,$2,$3,$4,now() + interval '10 minutes')
      on conflict (user_id, surface) do update set code_hash=excluded.code_hash, salt=excluded.salt,
        expires_at=excluded.expires_at, requested_at=now(), attempts=0
      where staff_email_code.requested_at < now() - interval '60 seconds' returning user_id`,
      [actor.userId, surface, hash, salt]);
    if (!r.rowCount) return generic;
    try {
      const mail = nodemailer.createTransport(process.env.SMTP_URL!);
      await mail.sendMail({ from: process.env.MAIL_FROM ?? "The Vedanta <bookings@thevedanta.org>", to: actor.email,
        subject: "Your Vedanta staff sign-in code", text: `Your Vedanta staff sign-in code is ${code}.\n\nIt expires in 10 minutes and works once. If you did not request it, ignore this email.` });
    } catch {
      await pool.query("delete from staff_email_code where user_id=$1 and surface=$2 and code_hash=$3", [actor.userId, surface, hash]);
      return reply.code(503).send(problem(503, "email_unavailable", "We could not send a code right now. Please try again later."));
    }
    return generic;
  });

  f.post<{ Body: { email?: string; code?: string; surface?: string } }>("/auth/email-code/verify", async (req, reply) => {
    if (!staffEmailCodeEnabled()) return reply.code(503).send(problem(503, "email_unavailable", "Email sign-in is not configured yet"));
    if (!limit(`verify:${req.ip}`, 12)) return reply.code(429).send(problem(429, "rate_limited", "Wait a minute before trying again"));
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const code = String(req.body?.code ?? "").replace(/\s/g, "");
    const surface = req.body?.surface === "staff" ? "STAFF" : "ADMIN";
    const fail = () => reply.code(401).send(problem(401, "invalid_code", "The code is invalid or expired. Request a new one."));
    if (email.length > 254 || !/^\d{8}$/.test(code)) return fail();
    const client = await pool.connect();
    try {
      await client.query("begin");
      const r = await client.query(`select c.user_id, c.code_hash, c.salt, c.attempts, c.expires_at
        from staff_email_code c join app_user u on u.id=c.user_id
        where lower(u.email)=$1 and c.surface=$2 for update of c`, [email, surface]);
      const row = r.rows[0];
      if (!row || row.attempts >= 5 || new Date(row.expires_at).getTime() <= Date.now()) { await client.query("rollback"); return fail(); }
      if (!matches(code, row.salt, row.code_hash)) {
        await client.query("update staff_email_code set attempts=attempts+1 where user_id=$1 and surface=$2", [row.user_id, surface]);
        await client.query("commit"); return fail();
      }
      const actor = await loadActor("where u.id = $1", row.user_id);
      if (!actor) { await client.query("rollback"); return fail(); }
      await client.query("delete from staff_email_code where user_id=$1 and surface=$2", [row.user_id, surface]);
      const token = randomBytes(32).toString("base64url");
      await client.query(`insert into session (token, user_id, property_id, audience, expires_at)
        values ($1,$2,$3,$4,now() + interval '12 hours')`, [token, actor.userId, actor.propertyId, surface]);
      await client.query("commit");
      return { token, user: { email: actor.email, name: actor.name, role: actor.role, role_name: actor.roleName,
        department: actor.department, permissions: [...actor.perms], surface } };
    } catch (e) { await client.query("rollback"); throw e; }
    finally { client.release(); }
  });
}
