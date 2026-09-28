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
import { depositLine, FOOD_IS_NOT_BILLED, parseDepositSettings, stripeChargeAllowed } from "../../../domains/payments/deposit.ts";
import { interpretStripeEvent, verifyStripeSignature, type StripeEffect } from "../../../domains/payments/stripeEvent.ts";
import { sendEmail } from "./email.ts";
import { scheduleAutoComms } from "./autocomms.ts";

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

async function applyStripeEffect(event: { data?: { object?: { metadata?: Record<string, string> } } }, effect: StripeEffect) {
  const metaProperty = event.data?.object?.metadata?.property_id ?? null;
  const enquirySql = `SELECT id, tenant_id, property_id, booking_id, email, name, deposit_status FROM guest_enquiry WHERE id=$1`;
  let enquiry = effect.enquiryId ? (await pool.query(enquirySql, [effect.enquiryId])).rows[0] : null;
  if (!enquiry && effect.sessionId) {
    enquiry = (await pool.query(
      `SELECT id, tenant_id, property_id, booking_id, email, name, deposit_status FROM guest_enquiry WHERE stripe_session_id=$1`,
      [effect.sessionId],
    )).rows[0] ?? null;
  }
  const groupSql = `SELECT id, tenant_id, property_id, name, contact_email, deposit_status FROM booking_group WHERE id=$1`;
  let group = (effect.groupId || enquiry?.booking_id) ? (await pool.query(groupSql, [effect.groupId || enquiry.booking_id])).rows[0] : null;

  let folio = effect.folioId
    ? (await pool.query(`SELECT id, tenant_id, property_id, group_id, enquiry_id FROM folio WHERE id=$1`, [effect.folioId])).rows[0]
    : null;
  if (!folio && effect.intentId) {
    folio = (await pool.query(
      `SELECT f.id, f.tenant_id, f.property_id, f.group_id, f.enquiry_id
       FROM payment p JOIN folio f ON f.id = p.folio_id
       WHERE p.stripe_payment_intent_id=$1 AND p.kind <> 'refund' LIMIT 1`,
      [effect.intentId],
    )).rows[0] ?? null;
  }
  if (!folio && (group || enquiry)) {
    folio = (await pool.query(
      `SELECT id, tenant_id, property_id, group_id, enquiry_id FROM folio
       WHERE ($1::uuid IS NOT NULL AND group_id=$1) OR ($2::uuid IS NOT NULL AND enquiry_id=$2)
       ORDER BY created_at LIMIT 1`,
      [group?.id ?? null, enquiry?.id ?? null],
    )).rows[0] ?? null;
  }
  if (!group && folio?.group_id) group = (await pool.query(groupSql, [folio.group_id])).rows[0] ?? null;
  if (!enquiry && folio?.enquiry_id) enquiry = (await pool.query(enquirySql, [folio.enquiry_id])).rows[0] ?? null;

  const tenantId = enquiry?.tenant_id ?? group?.tenant_id ?? folio?.tenant_id ?? null;
  const propertyId = enquiry?.property_id ?? group?.property_id ?? folio?.property_id ?? metaProperty;
  if (!tenantId || !propertyId) return;

  if (!folio && (group || enquiry)) {
    folio = (await pool.query(
      `INSERT INTO folio (tenant_id, property_id, group_id, enquiry_id, currency, total_agreed)
       VALUES ($1,$2,$3,$4,'GBP',$5) RETURNING id, tenant_id, property_id, group_id, enquiry_id`,
      [tenantId, propertyId, group?.id ?? null, enquiry?.id ?? null, effect.amountGbp || null],
    )).rows[0];
  }

  const intentKey = effect.intentId ?? (effect.sessionId ? `session:${effect.sessionId}` : null);

  if (effect.action === "paid" && folio && intentKey) {
    const payment = (await pool.query(
      `INSERT INTO payment (tenant_id, folio_id, kind, method, amount, stripe_payment_intent_id, stripe_status, paid_at, reference, note)
       VALUES ($1,$2,'deposit','stripe',$3,$4,'succeeded',now(),$5,'Paid online via Stripe. Food is not billed.')
       ON CONFLICT (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [tenantId, folio.id, effect.amountGbp, intentKey, effect.sessionId ?? effect.intentId],
    )).rows[0];
    if (enquiry) {
      await pool.query(
        `UPDATE guest_enquiry SET deposit_status='paid', deposit_paid_at=coalesce(deposit_paid_at, now()), deposit_amount=CASE WHEN $2::numeric > 0 THEN $2 ELSE deposit_amount END WHERE id=$1`,
        [enquiry.id, effect.amountGbp],
      );
    }
    if (group) await pool.query(`UPDATE booking_group SET deposit_status='paid' WHERE id=$1`, [group.id]);
    if (payment) {
      const to = enquiry?.email ?? group?.contact_email;
      const who = enquiry?.name ?? group?.name ?? "guest";
      if (to) {
        await sendEmail({ tenantId, propertyId }, {
          to,
          subject: `Deposit received — £${Number(effect.amountGbp).toFixed(2)}`,
          body: `Dear ${who},\n\nWe have received your deposit of £${Number(effect.amountGbp).toFixed(2)}. ${FOOD_IS_NOT_BILLED}\n\nThe house will confirm your place. Reference: ${intentKey}.\n`,
          kind: "deposit_received",
          related_type: enquiry ? "guest_enquiry" : "booking_group",
          related_id: enquiry?.id ?? group?.id,
        });
      }
      if (group) {
        try { await scheduleAutoComms(group.id, tenantId, propertyId); }
        catch (err) { console.error("[stripe] confirmation schedule failed", err); }
      }
    }
    return;
  }

  if (effect.action === "failed") {
    if (enquiry) await pool.query(`UPDATE guest_enquiry SET deposit_status='failed' WHERE id=$1 AND deposit_status='unpaid'`, [enquiry.id]);
    if (group) await pool.query(`UPDATE booking_group SET deposit_status='failed' WHERE id=$1 AND deposit_status='unpaid'`, [group.id]);
    return;
  }

  if (effect.action === "refunded" && folio && effect.intentId) {
    const refundKey = `${effect.intentId}:refund`;
    await pool.query(
      `INSERT INTO payment (tenant_id, folio_id, kind, method, amount, stripe_payment_intent_id, stripe_status, paid_at, reference, note)
       VALUES ($1,$2,'refund','stripe',$3,$4,'refunded',now(),$5,'Deposit refunded via Stripe. Food is not billed.')
       ON CONFLICT (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL
       DO UPDATE SET amount=EXCLUDED.amount, paid_at=now(), stripe_status='refunded'`,
      [tenantId, folio.id, effect.amountGbp, refundKey, effect.intentId],
    );
    if (enquiry) await pool.query(`UPDATE guest_enquiry SET deposit_status='refunded' WHERE id=$1`, [enquiry.id]);
    if (group) await pool.query(`UPDATE booking_group SET deposit_status='refunded' WHERE id=$1`, [group.id]);
  }
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
      "payment_intent_data[metadata][group_id]": req.params.id,
      "payment_intent_data[metadata][folio_id]": g.folio_id ?? "",
      "payment_intent_data[metadata][kind]": kind,
      "payment_intent_data[metadata][property_id]": a.propertyId,
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
      "payment_intent_data[metadata][enquiry_id]": req.params.id,
      "payment_intent_data[metadata][property_id]": enquiry.property_id,
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

  // Stripe webhook. Unsigned events are refused, including when no secret is set.
  f.post("/webhooks/stripe", async (req: any, reply) => {
    const sig = String(req.headers["stripe-signature"] ?? "");
    const raw = typeof req.rawBody === "string" ? req.rawBody : "";
    const check = verifyStripeSignature(raw, sig, WEBHOOK_SECRET);
    if (!check.ok) {
      if (check.reason === "unconfigured") {
        req.log.warn("Stripe webhook rejected: STRIPE_WEBHOOK_SECRET is not set");
        console.warn("[stripe] webhook rejected: STRIPE_WEBHOOK_SECRET is not set");
        return reply.code(503).send(problem(503, "webhook_unconfigured", "Stripe webhooks are not configured. Set STRIPE_WEBHOOK_SECRET before accepting events."));
      }
      return reply.code(400).send(problem(400, "invalid_signature", "The Stripe signature did not match the raw body."));
    }

    let event: any;
    try { event = JSON.parse(raw); } catch { return reply.code(400).send(problem(400, "invalid_json", "The webhook body was not JSON.")); }
    if (!event?.id || !event?.type) return reply.code(400).send(problem(400, "invalid_event", "The webhook had no event id."));

    const inserted = (await pool.query(
      `INSERT INTO stripe_event (id, kind, payload, processed_at) VALUES ($1,$2,$3,now()) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [event.id, event.type, JSON.stringify(stripeAuditPayload(event))],
    )).rows[0];
    if (!inserted) return { ok: true, duplicate: true };
    if (!paymentsEnabled()) return { ok: true, ignored: true };

    const effect = interpretStripeEvent(event);
    if (effect.action !== "ignore") await applyStripeEffect(event, effect);
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
