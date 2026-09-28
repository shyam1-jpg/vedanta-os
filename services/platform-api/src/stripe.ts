/**
 * Stripe payment integration
 * - Creates Stripe Checkout sessions for guest deposits
 * - Handles webhooks to mark payments as received
 * - Links payment intents to folios and guest enquiries
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY   — sk_live_... or sk_test_...
 *   STRIPE_WEBHOOK_SECRET — whsec_...
 *   WEB_URL             — https://admin.thevedanta.org (for redirect URLs)
 */
import type { FastifyInstance } from "fastify";
import { pool } from "./db.ts";
import { requireActor, allow, problem } from "./auth.ts";
import { bodyHasCardData, paymentsEnabled, stripeAuditPayload } from "./payments.ts";
import { depositLine, parseDepositSettings, stripeChargeAllowed } from "../../../domains/payments/deposit.ts";

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY ?? "";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";
const WEB_URL = process.env.WEB_URL ?? "https://admin.thevedanta.org";

async function stripeRequest(path: string, body?: Record<string, string | number | boolean | undefined>) {
  if (!STRIPE_KEY) throw new Error("STRIPE_SECRET_KEY not configured");
  const encoded = body
    ? Object.entries(body)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&")
    : undefined;
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: encoded,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe error: ${(data as any)?.error?.message ?? res.status}`);
  return data as any;
}

function liveChargesEnabled(): boolean {
  return ["1", "true", "yes", "on"].includes((process.env.PAYMENTS_LIVE ?? "").trim().toLowerCase());
}

function chargeGate(reply: any) {
  const gate = stripeChargeAllowed({ paymentsEnabled: paymentsEnabled(), secretKey: STRIPE_KEY, liveEnabled: liveChargesEnabled() });
  if (!gate.ok) return reply.code(gate.status).send(problem(gate.status, gate.code, gate.detail));
  return null;
}

function refuseCard(req: any, reply: any) {
  if (!bodyHasCardData(req.body)) return false;
  reply.code(422).send(problem(422, "card_data_refused", "Do not send a card number or security code. The payment page collects the card."));
  return true;
}

export default async function stripe(f: FastifyInstance) {
  f.get("/guest/payments", async () => ({ enabled: paymentsEnabled() }));

  // Create a Stripe Checkout session for a deposit on a booking group
  f.post<{ Params: { id: string } }>("/v1/groups/:id/stripe/checkout", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.update", reply)) return;
    if (chargeGate(reply)) return;
    if (refuseCard(req, reply)) return;

    const g = (await pool.query(
      `SELECT g.id, g.name, g.contact_email, g.organisation,
              coalesce(nullif(trim(p.given_name || ' ' || coalesce(p.family_name, '')), ''), g.organisation) AS contact_name,
              f.id AS folio_id, f.balance_due, f.total_agreed
       FROM booking_group g
       LEFT JOIN person p ON p.id = g.organiser_person_id
       LEFT JOIN folio f ON f.group_id = g.id
       WHERE g.id=$1 AND g.property_id=$2`, [req.params.id, a.propertyId]
    )).rows[0];

    if (!g) return reply.code(404).send(problem(404, "not_found", "Booking not found"));

    const { amount, kind = "deposit", description } = req.body ?? {};
    const amountPence = Math.round(Number(amount ?? g.balance_due ?? 0) * 100);
    if (!amountPence || amountPence < 50) return reply.code(422).send(problem(422, "validation", "amount must be at least £0.50"));

    const prop = (await pool.query(`SELECT name FROM property WHERE id=$1`, [a.propertyId])).rows[0];

    const session = await stripeRequest("/checkout/sessions", {
      "payment_method_types[0]": "card",
      "line_items[0][price_data][currency]": "gbp",
      "line_items[0][price_data][unit_amount]": amountPence,
      "line_items[0][price_data][product_data][name]": description ?? `${kind === "deposit" ? "Deposit" : "Payment"} — ${g.name}`,
      "line_items[0][price_data][product_data][description]": `${prop?.name ?? "The Vedanta Way"} · ${g.name}`,
      "line_items[0][quantity]": 1,
      mode: "payment",
      customer_email: g.contact_email ?? undefined,
      "success_url": `${WEB_URL}/groups/?stripe=success&session={CHECKOUT_SESSION_ID}`,
      "cancel_url": `${WEB_URL}/groups/?stripe=cancelled`,
      "metadata[group_id]": req.params.id,
      "metadata[folio_id]": g.folio_id ?? "",
      "metadata[kind]": kind,
      "metadata[property_id]": a.propertyId,
    });

    return { url: session.url, session_id: session.id };
  });

  // Create a Stripe Checkout session for a guest deposit on an enquiry
  f.post<{ Params: { id: string } }>("/v1/guest-enquiries/:id/stripe/checkout", async (req: any, reply) => {
    if (chargeGate(reply)) return;
    if (refuseCard(req, reply)) return;
    const tok = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!tok) return reply.code(401).send(problem(401, "unauthorized", "Sign in first"));

    const enquiry = (await pool.query(
      `SELECT ge.id, ge.people, ge.arrival_date::text AS arrival, ge.departure_date::text AS departure,
              ge.deposit_amount, ge.name AS guest_name, bg.name AS programme_name,
              ga.email, ga.display_name, p.name AS prop_name, p.id AS property_id, p.settings
       FROM guest_enquiry ge
       JOIN guest_session gs ON gs.guest_id = ge.guest_id AND gs.token = $2 AND gs.expires_at > now()
       JOIN guest_account ga ON ga.id = ge.guest_id
       JOIN property p ON p.id = ge.property_id
       LEFT JOIN booking_group bg ON bg.id = ge.programme_id
       WHERE ge.id=$1`, [req.params.id, tok]
    )).rows[0];

    if (!enquiry) return reply.code(404).send(problem(404, "not_found", "Enquiry not found or not yours"));

    const configured = parseDepositSettings(enquiry.settings?.deposit);
    const depositPence = Math.round(Number(enquiry.deposit_amount ?? configured.amount_gbp) * 100);
    if (depositPence < 50) return reply.code(422).send(problem(422, "validation", "The deposit is below the card minimum. The house can confirm it instead."));
    const line = depositLine({ amountGbp: depositPence / 100, guest: enquiry.programme_name ?? enquiry.guest_name ?? "My Stay", house: enquiry.prop_name ?? "The Vedanta Way" });

    const session = await stripeRequest("/checkout/sessions", {
      "payment_method_types[0]": "card",
      "line_items[0][price_data][currency]": "gbp",
      "line_items[0][price_data][unit_amount]": depositPence,
      "line_items[0][price_data][product_data][name]": line.name,
      "line_items[0][price_data][product_data][description]": `${line.description} ${enquiry.arrival} → ${enquiry.departure} · ${enquiry.people} guest${enquiry.people > 1 ? "s" : ""}`,
      "line_items[0][quantity]": 1,
      mode: "payment",
      customer_email: enquiry.email,
      "success_url": `${WEB_URL}/book/?stripe=success&session={CHECKOUT_SESSION_ID}`,
      "cancel_url": `${WEB_URL}/book/?stripe=cancelled`,
      "metadata[enquiry_id]": req.params.id,
      "metadata[property_id]": enquiry.property_id,
    });

    await pool.query(`UPDATE guest_enquiry SET stripe_session_id=$2, deposit_amount=$3 WHERE id=$1`, [req.params.id, session.id, depositPence / 100]);

    return { url: session.url, session_id: session.id };
  });

  f.get("/v1/settings/deposit", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "package.manage", reply)) return;
    const row = (await pool.query(`select settings from property where id=$1`, [a.propertyId])).rows[0];
    return { ...parseDepositSettings(row?.settings?.deposit), food_billed: false };
  });

  f.put("/v1/settings/deposit", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "package.manage", reply)) return;
    const deposit = parseDepositSettings(req.body);
    await pool.query(
      `update property set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{deposit}', $2::jsonb, true) where id=$1`,
      [a.propertyId, JSON.stringify(deposit)],
    );
    return { ...deposit, food_billed: false };
  });

  // Stripe webhook — mark payments as received when checkout.session.completed fires
  f.post("/webhooks/stripe", { config: { rawBody: true } }, async (req: any, reply) => {
    const sig = req.headers["stripe-signature"] ?? "";
    const payload = req.rawBody ?? req.body;

    // Verify webhook signature (HMAC-SHA256)
    if (WEBHOOK_SECRET && sig) {
      try {
        const crypto = await import("crypto");
        const [, ts] = sig.split(",").find((p: string) => p.startsWith("t="))?.split("=") ?? [];
        const [, v1] = sig.split(",").find((p: string) => p.startsWith("v1="))?.split("=") ?? [];
        const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(`${ts}.${payload}`).digest("hex");
        if (expected !== v1) return reply.code(400).send({ error: "Invalid signature" });
      } catch { return reply.code(400).send({ error: "Signature check failed" }); }
    }

    let event: any;
    try { event = typeof payload === "string" ? JSON.parse(payload) : payload; } catch { return reply.code(400).send({ error: "Invalid JSON" }); }

    // Idempotency check
    const already = (await pool.query(`SELECT id FROM stripe_event WHERE id=$1`, [event.id])).rows[0];
    if (already) return { ok: true, duplicate: true };
    await pool.query(`INSERT INTO stripe_event (id, kind, payload, processed_at) VALUES ($1,$2,$3,now()) ON CONFLICT DO NOTHING`, [event.id, event.type, JSON.stringify(stripeAuditPayload(event))]);
    if (!paymentsEnabled()) return { ok: true, ignored: true };

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const meta = session.metadata ?? {};
      const amountGbp = (session.amount_total ?? 0) / 100;

      if (meta.folio_id && meta.group_id) {
        // Staff booking payment
        await pool.query(`
          INSERT INTO payment (tenant_id, folio_id, kind, method, amount, stripe_payment_intent_id, stripe_status, paid_at, reference, note)
          SELECT f.tenant_id, f.id, $2, 'stripe', $3, $4, 'succeeded', now(), $5, 'Paid online via Stripe'
          FROM folio f WHERE f.id = $1`,
          [meta.folio_id, meta.kind ?? "deposit", amountGbp, session.payment_intent ?? session.id, session.id]);
      }

      if (meta.enquiry_id) {
        // Guest portal deposit
        await pool.query(`UPDATE guest_enquiry SET deposit_paid_at=now(), deposit_amount=$2 WHERE id=$1`, [meta.enquiry_id, amountGbp]);
      }
    }

    return { ok: true };
  });

  // Check Stripe configuration status
  f.get("/v1/stripe/status", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.update", reply)) return;
    return {
      enabled: paymentsEnabled(),
      configured: paymentsEnabled() && !!STRIPE_KEY,
      webhook_configured: !!WEBHOOK_SECRET,
      mode: !paymentsEnabled() ? "disabled" : STRIPE_KEY.startsWith("sk_live") ? (liveChargesEnabled() ? "live" : "live_blocked") : STRIPE_KEY.startsWith("sk_test") ? "test" : "not_configured",
    };
  });
}
