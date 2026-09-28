/**
 * Stripe webhook checks. The raw body is what Stripe signed.
 * An unset webhook secret is a rejection, not an open door.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type StripeEffect = {
  action: "paid" | "failed" | "refunded" | "ignore";
  intentId: string | null;
  amountGbp: number;
  enquiryId: string | null;
  groupId: string | null;
  folioId: string | null;
  sessionId: string | null;
};

type StripeObject = Record<string, unknown> & {
  id?: string;
  metadata?: Record<string, string>;
  payment_intent?: string;
  amount_total?: number;
  amount_received?: number;
  amount_refunded?: number;
};

function meta(object: StripeObject | undefined, key: string): string | null {
  const value = object?.metadata?.[key];
  return value ? String(value) : null;
}

export function verifyStripeSignature(rawBody: string, header: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): { ok: true } | { ok: false; reason: "unconfigured" | "missing" | "mismatch" | "stale" } {
  if (!secret) return { ok: false, reason: "unconfigured" };
  const parts = header.split(",").map(part => part.trim()).filter(Boolean);
  const timestamp = parts.find(part => part.startsWith("t="))?.slice(2);
  const signatures = parts.filter(part => part.startsWith("v1=")).map(part => part.slice(3));
  if (!timestamp || !signatures.length) return { ok: false, reason: "missing" };
  const age = Math.abs(nowSec - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return { ok: false, reason: "stale" };
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuf = Buffer.from(expected);
  const match = signatures.some(signature => {
    const given = Buffer.from(signature);
    return given.length === expectedBuf.length && timingSafeEqual(given, expectedBuf);
  });
  return match ? { ok: true } : { ok: false, reason: "mismatch" };
}

export function interpretStripeEvent(event: { type?: string; data?: { object?: StripeObject } }): StripeEffect {
  const object = event.data?.object ?? {};
  const base = {
    intentId: typeof object.payment_intent === "string" ? object.payment_intent : (event.type?.startsWith("payment_intent.") ? object.id ?? null : null),
    amountGbp: 0,
    enquiryId: meta(object, "enquiry_id"),
    groupId: meta(object, "group_id"),
    folioId: meta(object, "folio_id"),
    sessionId: event.type === "checkout.session.completed" ? object.id ?? null : null,
  };
  if (event.type === "checkout.session.completed" || event.type === "payment_intent.succeeded") {
    const minor = event.type === "checkout.session.completed" ? object.amount_total : object.amount_received;
    return { ...base, action: "paid", amountGbp: Number(minor ?? 0) / 100 };
  }
  if (event.type === "payment_intent.payment_failed") return { ...base, action: "failed" };
  if (event.type === "charge.refunded") {
    return { ...base, action: "refunded", amountGbp: Number(object.amount_refunded ?? 0) / 100 };
  }
  return { ...base, action: "ignore" };
}
