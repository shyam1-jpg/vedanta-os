import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { interpretStripeEvent, verifyStripeSignature } from "./stripeEvent.ts";

const secret = "whsec_test_secret";
const raw = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
const now = 1_700_000_000;

function header(body = raw, stamp = now, sigSecret = secret) {
  const v1 = createHmac("sha256", sigSecret).update(`${stamp}.${body}`).digest("hex");
  return `t=${stamp},v1=${v1}`;
}

describe("stripe signature", () => {
  it("accepts a signed raw body", () => {
    assert.deepEqual(verifyStripeSignature(raw, header(), secret, now), { ok: true });
  });

  it("rejects a missing secret, a bad signature, and a stale timestamp", () => {
    assert.equal(verifyStripeSignature(raw, header(), "", now).ok, false);
    assert.equal(verifyStripeSignature(raw, "t=1700000000,v1=deadbeef", secret, now).ok, false);
    assert.equal(verifyStripeSignature(raw, header(raw, now - 1000), secret, now).ok, false);
  });
});

describe("stripe fixtures", () => {
  const session = {
    id: "cs_test_1",
    amount_total: 20000,
    payment_intent: "pi_test_1",
    metadata: { enquiry_id: "enq-1", group_id: "grp-1", folio_id: "fol-1" },
  };

  it("records a completed checkout as a paid deposit", () => {
    const effect = interpretStripeEvent({ type: "checkout.session.completed", data: { object: session } });
    assert.equal(effect.action, "paid");
    assert.equal(effect.amountGbp, 200);
    assert.equal(effect.enquiryId, "enq-1");
    assert.equal(effect.intentId, "pi_test_1");
  });

  it("records payment_intent.succeeded", () => {
    const effect = interpretStripeEvent({
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_test_1", amount_received: 20000, metadata: { enquiry_id: "enq-1" } } },
    });
    assert.equal(effect.action, "paid");
    assert.equal(effect.intentId, "pi_test_1");
    assert.equal(effect.amountGbp, 200);
  });

  it("records a failed payment and a refund", () => {
    assert.equal(interpretStripeEvent({
      type: "payment_intent.payment_failed",
      data: { object: { id: "pi_test_2", metadata: { group_id: "grp-1" } } },
    }).action, "failed");
    const refund = interpretStripeEvent({
      type: "charge.refunded",
      data: { object: { id: "ch_1", payment_intent: "pi_test_1", amount_refunded: 20000, metadata: { enquiry_id: "enq-1" } } },
    });
    assert.equal(refund.action, "refunded");
    assert.equal(refund.amountGbp, 200);
    assert.equal(refund.intentId, "pi_test_1");
  });
});

describe("webhook wiring", () => {
  it("requires a signature and does not accept an unsigned event", () => {
    const src = readFileSync(new URL("../../services/platform-api/src/stripe.ts", import.meta.url), "utf8");
    assert.match(src, /verifyStripeSignature/);
    assert.match(src, /webhook_unconfigured/);
    assert.match(src, /interpretStripeEvent/);
    assert.match(src, /payment_intent_data\[metadata\]\[enquiry_id\]/);
    assert.match(src, /deposit_status='paid'/);
    assert.doesNotMatch(src, /if \(WEBHOOK_SECRET && sig\)/);
  });
});
