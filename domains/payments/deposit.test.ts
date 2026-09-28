import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { depositLine, parseDepositSettings, stripeChargeAllowed } from "./deposit.ts";

describe("deposit settings", () => {
  it("defaults to £200 and never describes a food charge", () => {
    const settings = parseDepositSettings(undefined);
    assert.equal(settings.amount_gbp, 200);
    assert.match(settings.policy, /Food is not billed/);
    const line = depositLine({ amountGbp: settings.amount_gbp, guest: "Quiet weekend", house: "The Vedanta Way" });
    assert.match(line.name, /^Deposit/);
    assert.doesNotMatch(line.name, /food/i);
    assert.match(line.description, /Food is not billed/);
  });

  it("keeps an edited amount inside a sane range", () => {
    assert.equal(parseDepositSettings({ amount_gbp: 75.5, policy: "Half on booking." }).amount_gbp, 75.5);
    assert.equal(parseDepositSettings({ amount_gbp: -4 }).amount_gbp, 0);
    assert.equal(parseDepositSettings({ amount_gbp: 9_999_999 }).amount_gbp, 100_000);
  });
});

describe("stripe charge switch", () => {
  it("stays off until payments are enabled", () => {
    const off = stripeChargeAllowed({ paymentsEnabled: false, secretKey: "sk_test_123", liveEnabled: false });
    assert.equal(off.ok, false);
  });

  it("allows a test key only after payments are enabled", () => {
    const test = stripeChargeAllowed({ paymentsEnabled: true, secretKey: "sk_test_123", liveEnabled: false });
    assert.equal(test.ok, true);
    if (test.ok) assert.equal(test.mode, "test");
  });

  it("refuses a live key until live charges are turned on", () => {
    const live = stripeChargeAllowed({ paymentsEnabled: true, secretKey: "sk_live_123", liveEnabled: false });
    assert.equal(live.ok, false);
    if (!live.ok) assert.equal(live.code, "live_charges_disabled");
    const allowed = stripeChargeAllowed({ paymentsEnabled: true, secretKey: "sk_live_123", liveEnabled: true });
    assert.equal(allowed.ok, true);
  });
});

describe("guest checkout path", () => {
  it("calls the versioned route and does not submit the enquiry again from the card error", () => {
    const page = readFileSync(new URL("../../apps/web-guest/app/page.tsx", import.meta.url), "utf8");
    assert.match(page, /`\/v1\/guest-enquiries\/\$\{enquiryResult\.id\}\/stripe\/checkout`/);
    assert.doesNotMatch(page, /`\/guest-enquiries\/\$\{enquiryResult\.id\}\/stripe\/checkout`/);
    assert.match(page, /savedEnquiryId/);
  });
});
