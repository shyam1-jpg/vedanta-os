import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bodyHasCardData, paymentsEnabled, stripeAuditPayload } from "./payments.ts";

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("card payments", () => {
  it("stays off unless the house turns the flag on", () => {
    const prev = process.env.PAYMENTS_ENABLED;
    delete process.env.PAYMENTS_ENABLED;
    try {
      assert.equal(paymentsEnabled(), false);
      process.env.PAYMENTS_ENABLED = "true";
      assert.equal(paymentsEnabled(), true);
    } finally { restore("PAYMENTS_ENABLED", prev); }
  });

  it("refuses a card number or security code in a request", () => {
    assert.equal(bodyHasCardData({ amount: 200 }), false);
    assert.equal(bodyHasCardData({ card_number: "4242424242424242" }), true);
    assert.equal(bodyHasCardData({ payment: { cvv: "123" } }), true);
  });

  it("keeps only provider ids from a Stripe event", () => {
    const stored = stripeAuditPayload({
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { payment_intent: "pi_1", amount_total: 20000, metadata: { group_id: "g1" }, card: { number: "4242424242424242", cvc: "123" } } },
    });
    assert.equal(JSON.stringify(stored).includes("4242"), false);
    assert.equal(stored.payment_intent, "pi_1");
    assert.equal(stored.amount_total, 20000);
  });
});
