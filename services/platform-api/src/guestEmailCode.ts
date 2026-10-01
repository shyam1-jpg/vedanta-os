/**
 * One-time email code for a new guest My Stay.
 * Requesting a code does not create a guest account or a session.
 * The code is emailed, stored only as a salted hash, and checked by the
 * registration gate before /guest/register or /guest/enquiries can proceed.
 * Staff email codes live in staffEmailCode.ts and are not used here.
 */
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";
import type { FastifyInstance } from "fastify";
import { pool } from "./db.ts";
import { problem } from "./auth.ts";
import {
  EMAIL_ALREADY_ON_BOOK,
  EMAIL_CODE_SENT,
  EMAIL_CODE_UNAVAILABLE,
  normalizeGuestEmail,
} from "../../../domains/guest/signup.ts";

const requested = new Map<string, { count: number; since: number }>();
function limit(key: string, max: number) {
  const now = Date.now();
  const hit = requested.get(key);
  if (!hit || now - hit.since > 60_000) { requested.set(key, { count: 1, since: now }); return true; }
  return ++hit.count <= max;
}

export const guestEmailDeliveryEnabled = () => !!process.env.SMTP_URL;

export function guestEmailCodeHash(code: string, salt: string) {
  return scryptSync(code, salt, 32).toString("hex");
}

export function guestEmailCodeMatches(code: string, salt: string, expected: string) {
  if (!/^\d{8}$/.test(code) || !/^[a-f0-9]{64}$/.test(expected)) return false;
  return timingSafeEqual(Buffer.from(guestEmailCodeHash(code, salt), "hex"), Buffer.from(expected, "hex"));
}

function strictEmail(value: unknown): string | null {
  const email = normalizeGuestEmail(value);
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function greetingName(value: unknown): string {
  const name = String(value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 120);
  return name || "Guest";
}

export function normalizeGuestEmailCode(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, "");
}

/** Check and consume a signup code. Does not create a guest or a session. */
export async function takeGuestEmailCode(email: string, code: unknown): Promise<"ok" | "invalid"> {
  const normalized = strictEmail(email);
  const digits = normalizeGuestEmailCode(code);
  if (!normalized || !/^\d{8}$/.test(digits)) return "invalid";
  const client = await pool.connect();
  try {
    await client.query("begin");
    const r = await client.query(
      `select code_hash, salt, attempts, expires_at from guest_email_code where email=$1 for update`,
      [normalized],
    );
    const row = r.rows[0];
    const unexpired = !!row && new Date(row.expires_at).getTime() > Date.now();
    const locked = !!row && row.attempts >= 5;
    if (!row || !unexpired || locked || !guestEmailCodeMatches(digits, row.salt, row.code_hash)) {
      if (row && unexpired && !locked) {
        await client.query(`update guest_email_code set attempts=attempts+1 where email=$1`, [normalized]);
      }
      await client.query("commit");
      return "invalid";
    }
    await client.query(`delete from guest_email_code where email=$1`, [normalized]);
    await client.query("commit");
    return "ok";
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

export default async function guestEmailCode(f: FastifyInstance) {
  f.post<{ Body: { email?: string; name?: string } }>("/guest/email-code/request", async (req, reply) => {
    if (!guestEmailDeliveryEnabled()) {
      return reply.code(503).send(problem(503, "email_unavailable", EMAIL_CODE_UNAVAILABLE));
    }
    if (!limit(`guest-code:${req.ip}`, 8)) {
      return reply.code(429).send(problem(429, "rate_limited", "Wait a minute before requesting another code"));
    }
    const email = strictEmail(req.body?.email);
    if (!email) return reply.code(422).send(problem(422, "validation", "Enter the email address you want to use for My Stay"));
    const existing = (await pool.query(
      `select id from guest_account where lower(email)=$1 and status='ACTIVE' limit 1`,
      [email],
    )).rows[0];
    if (existing) return reply.code(409).send(problem(409, "guest_identity_verification_required", EMAIL_ALREADY_ON_BOOK));

    const code = String(randomInt(0, 100_000_000)).padStart(8, "0");
    const salt = randomBytes(16).toString("hex");
    const hash = guestEmailCodeHash(code, salt);
    const saved = await pool.query(
      `insert into guest_email_code (email, code_hash, salt, expires_at)
       values ($1,$2,$3, now() + interval '10 minutes')
       on conflict (email) do update set code_hash=excluded.code_hash, salt=excluded.salt,
         expires_at=excluded.expires_at, requested_at=now(), attempts=0
       where guest_email_code.requested_at < now() - interval '60 seconds'
       returning email`,
      [email, hash, salt],
    );
    if (!saved.rowCount) return { message: EMAIL_CODE_SENT };

    const name = greetingName(req.body?.name);
    try {
      const house = (await pool.query(`select name from property order by created_at limit 1`)).rows[0];
      const houseName = house?.name ?? "The Vedanta Way";
      const mail = nodemailer.createTransport(process.env.SMTP_URL!);
      await mail.sendMail({
        from: process.env.MAIL_FROM ?? `${houseName} <bookings@thevedanta.org>`,
        to: email,
        subject: `Your code to open ${houseName} My Stay`,
        text: `Dear ${name},\n\nYour code to open My Stay is ${code}.\n\nIt expires in 10 minutes and works once. Enter it on the booking page. If you did not ask for this, ignore this email.\n\n${houseName}`,
      });
    } catch {
      await pool.query(`delete from guest_email_code where email=$1 and code_hash=$2`, [email, hash]);
      return reply.code(503).send(problem(503, "email_unavailable", EMAIL_CODE_UNAVAILABLE));
    }
    return { message: EMAIL_CODE_SENT };
  });
}
