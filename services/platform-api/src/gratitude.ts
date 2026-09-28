/**
 * Public guest gratitude route, plus an owner-only reading list.
 *
 * GUEST_GRATITUDE_STORE defaults off. While it is off the route still accepts a note
 * and returns a confirmation, but it does not write a row.
 * Amounts go through the placeholder payment provider (pledged, not paid). This file
 * does not call Stripe or any other processor.
 */
import type { FastifyInstance } from "fastify";
import { pool } from "./db.ts";
import { problem, requireActor } from "./auth.ts";
import {
  acceptGratitude,
  gratitudeStoreEnabled,
  nextRateBucket,
  prepareGratitude,
  publicCatalogue,
  type PreparedGratitude,
  type RateBucket,
} from "../../../domains/guest/gratitude.ts";

const hits = new Map<string, RateBucket>();

function rateLimit(ip: string): boolean {
  const now = Date.now();
  if (hits.size > 1000) {
    for (const [key, bucket] of hits) {
      if (now - bucket.start >= 10 * 60_000) hits.delete(key);
    }
  }
  const decision = nextRateBucket(hits.get(ip), now);
  hits.set(ip, decision.bucket);
  return decision.allowed;
}

async function saveGratitude(row: PreparedGratitude): Promise<void> {
  const prop = (await pool.query(`select id, tenant_id from property order by created_at limit 1`)).rows[0];
  if (!prop) {
    const err = new Error("The house is not ready to keep notes yet.");
    (err as { status?: number; code?: string }).status = 503;
    (err as { status?: number; code?: string }).code = "unavailable";
    throw err;
  }
  await pool.query(
    `insert into guest_gratitude
      (tenant_id, property_id, recipient_kind, recipient_code, recipient_label, message, guest_name, gesture, amount, currency, payment_status, payment_provider, distribution_status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'GBP',$10,$11,'undecided')`,
    [
      prop.tenant_id,
      prop.id,
      row.recipient.kind,
      row.recipient.id,
      row.recipient.label,
      row.message,
      row.guestName,
      row.gesture?.label ?? null,
      row.amount,
      row.payment.status,
      row.payment.provider,
    ],
  );
}

export default async function gratitudeRoutes(f: FastifyInstance) {
  f.get("/guest/gratitude", async () => publicCatalogue());

  f.post("/guest/gratitude", async (req: any, reply) => {
    const ip = req.ip || "local";
    if (!rateLimit(ip)) {
      return reply.code(429).send(problem(429, "rate_limited", "Too many notes from this connection. Please wait a few minutes."));
    }
    const body = req.body ?? {};
    const prepared = prepareGratitude({
      recipientId: body.recipient_id,
      message: body.message,
      guestName: body.guest_name,
      amount: body.amount,
      gesture: body.gesture,
      company: body.company,
    });
    if (!prepared.ok) return reply.code(422).send(problem(422, "validation", prepared.detail));
    const result = await acceptGratitude({
      prepared,
      storeEnabled: gratitudeStoreEnabled(process.env.GUEST_GRATITUDE_STORE),
      save: saveGratitude,
    });
    if ("error" in result) return reply.code(422).send(problem(422, "validation", result.error));
    return result.body;
  });

  f.get("/v1/guest-gratitude", async (req, reply) => {
    const actor = await requireActor(req, reply, "ADMIN");
    if (!actor) return;
    if (actor.role !== "SYSTEM_OWNER") {
      return reply.code(403).send(problem(403, "forbidden", "Only the owner can read guest gratitude notes"));
    }
    const rows = await pool.query(
      `select id, recipient_kind, recipient_code, recipient_label, message, guest_name, gesture,
              amount, currency, payment_status, payment_provider, distribution_status, created_at
       from guest_gratitude
       where property_id = $1
       order by created_at desc
       limit 200`,
      [actor.propertyId],
    );
    return {
      items: rows.rows.map(row => ({
        ...row,
        amount: row.amount == null ? null : String(row.amount),
      })),
    };
  });
}
