import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  GRATITUDE_RECIPIENTS,
  acceptGratitude,
  gratitudeStoreEnabled,
  nextRateBucket,
  parseGratitudeAmount,
  placeholderGratitudePayments,
  prepareGratitude,
  publicCatalogue,
} from "./gratitude.ts";

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

describe("gratitude catalogue", () => {
  it("uses placeholder people only", () => {
    const people = GRATITUDE_RECIPIENTS.filter(r => r.kind === "person").map(r => r.label);
    assert.deepEqual(people, ["Team member A", "Chef B"]);
    const labels = GRATITUDE_RECIPIENTS.map(r => r.label).join("\n");
    assert.doesNotMatch(labels, /@/);
    assert.equal(GRATITUDE_RECIPIENTS.some(r => r.kind === "team"), true);
    assert.deepEqual(
      GRATITUDE_RECIPIENTS.filter(r => r.kind === "department").map(r => r.label),
      ["Kitchen", "Housekeeping", "Reception"],
    );
  });

  it("does not allocate a share to anyone", () => {
    const prepared = prepareGratitude({ recipientId: "member-a", amount: "20" });
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    assert.equal(prepared.prepared.distributionStatus, "undecided");
    assert.equal("userId" in prepared.prepared, false);
    assert.equal("share" in prepared.prepared, false);
  });
});

describe("gratitude payments", () => {
  it("records a pledge and never a capture", () => {
    const result = placeholderGratitudePayments.record({ amount: "10.00", currency: "GBP" });
    assert.equal(result.status, "pledged_not_paid");
    assert.equal(result.provider, "placeholder");
    assert.equal(result.providerRef, null);
    assert.equal(placeholderGratitudePayments.id, "placeholder");
  });

  it("accepts preset and custom amounts, and a blank amount", () => {
    assert.deepEqual(parseGratitudeAmount(""), { ok: true, amount: null });
    assert.deepEqual(parseGratitudeAmount(null), { ok: true, amount: null });
    assert.deepEqual(parseGratitudeAmount("0"), { ok: true, amount: null });
    assert.deepEqual(parseGratitudeAmount("5"), { ok: true, amount: "5.00" });
    assert.deepEqual(parseGratitudeAmount("£10"), { ok: true, amount: "10.00" });
    assert.deepEqual(parseGratitudeAmount("12.5"), { ok: true, amount: "12.50" });
    assert.deepEqual(parseGratitudeAmount(20), { ok: true, amount: "20.00" });
    assert.equal(parseGratitudeAmount("0.50").ok, false);
    assert.equal(parseGratitudeAmount("500.01").ok, false);
    assert.equal(parseGratitudeAmount("12.345").ok, false);
    assert.equal(parseGratitudeAmount("ten").ok, false);
  });
});

describe("prepareGratitude", () => {
  it("keeps name and message optional and anonymous by default", () => {
    const prepared = prepareGratitude({ recipientId: "kitchen" });
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    assert.equal(prepared.prepared.anonymous, true);
    assert.equal(prepared.prepared.guestName, null);
    assert.equal(prepared.prepared.message, null);
    assert.equal(prepared.prepared.amount, null);
    assert.equal(prepared.prepared.gesture, null);
    assert.equal(prepared.discarded, false);
  });

  it("rejects an unknown recipient, a long message, a long name, and a free-text gesture", () => {
    assert.equal(prepareGratitude({ recipientId: "someone-real" }).ok, false);
    assert.equal(prepareGratitude({ recipientId: "team", message: "a".repeat(501) }).ok, false);
    assert.equal(prepareGratitude({ recipientId: "team", message: "a".repeat(500) }).ok, true);
    assert.equal(prepareGratitude({ recipientId: "team", guestName: "n".repeat(81) }).ok, false);
    assert.equal(prepareGratitude({ recipientId: "team", gesture: "a pony" }).ok, false);
    const ok = prepareGratitude({ recipientId: "chef-b", guestName: "A guest", message: "Lovely stay", gesture: "tea", amount: "10.00" });
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    assert.equal(ok.prepared.anonymous, false);
    assert.equal(ok.prepared.gesture?.label, "Tea for the team");
    assert.equal(ok.prepared.payment.status, "pledged_not_paid");
  });

  it("drops honeypot submissions before storage", async () => {
    const prepared = prepareGratitude({ recipientId: "team", message: "buy this", company: "https://spam.example" });
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    assert.equal(prepared.discarded, true);
    let saved = false;
    const res = await acceptGratitude({
      prepared,
      storeEnabled: true,
      save: async () => { saved = true; },
    });
    assert.equal(saved, false);
    assert.equal("body" in res && res.body.stored, false);
  });
});

describe("gratitude storage flag", () => {
  it("is off unless explicitly enabled", () => {
    assert.equal(gratitudeStoreEnabled(undefined), false);
    assert.equal(gratitudeStoreEnabled(null), false);
    assert.equal(gratitudeStoreEnabled(""), false);
    assert.equal(gratitudeStoreEnabled("false"), false);
    assert.equal(gratitudeStoreEnabled("0"), false);
    assert.equal(gratitudeStoreEnabled("true"), true);
    assert.equal(gratitudeStoreEnabled(" YES "), true);
  });

  it("does not call save when the flag is off, and does when it is on", async () => {
    const prepared = prepareGratitude({ recipientId: "reception", message: "Thank you", amount: "5.00" });
    assert.equal(prepared.ok, true);
    let calls = 0;
    const off = await acceptGratitude({
      prepared,
      storeEnabled: gratitudeStoreEnabled(undefined),
      save: async () => { calls += 1; },
    });
    assert.equal(calls, 0);
    assert.equal("body" in off && off.body.stored, false);
    assert.equal("body" in off && off.body.payment_status, "pledged_not_paid");
    assert.equal("body" in off && off.body.distribution_status, "undecided");
    assert.equal("body" in off && "share" in off.body, false);

    const on = await acceptGratitude({
      prepared,
      storeEnabled: true,
      save: async () => { calls += 1; },
    });
    assert.equal(calls, 1);
    assert.equal("body" in on && on.body.stored, true);
    assert.equal("body" in on && on.body.provider_ref, null);
  });
});

describe("gratitude rate limit", () => {
  it("allows five notes in a window and then asks the guest to wait", () => {
    let bucket: { count: number; start: number } | undefined;
    const start = 1_000_000;
    for (let i = 0; i < 5; i++) {
      const next = nextRateBucket(bucket, start + i);
      assert.equal(next.allowed, true);
      bucket = next.bucket;
    }
    const blocked = nextRateBucket(bucket, start + 10);
    assert.equal(blocked.allowed, false);
    const after = nextRateBucket(blocked.bucket, start + 10 * 60_000);
    assert.equal(after.allowed, true);
    assert.equal(after.bucket.count, 1);
  });
});

describe("gratitude page wiring", () => {
  it("publishes /thanks beside /book and does not link it from the guest book", () => {
    const html = read("../../apps/web-guest/gratitude/index.html");
    const embedded = JSON.parse(html.match(/<script id="gratitude-fallback" type="application\/json">([\s\S]*?)<\/script>/)?.[1] ?? "{}");
    assert.deepEqual(embedded, publicCatalogue());
    assert.match(html, /PLACEHOLDER/);
    assert.match(html, /not collected online yet/i);
    assert.doesNotMatch(html, /stripe|cc-number|cc-csc|cardnumber|payment_intent/i);
    assert.match(read("../../tools/build-web-bundle.mjs"), /apps\/web-guest\/gratitude/);
    assert.match(read("../../tools/live-proxy.mjs"), /\/thanks/);
    for (const rel of [
      "../../apps/web-guest/app/page.tsx",
      "../../apps/web-admin/components/Nav.tsx",
      "../../apps/web-admin/app/sign-in/page.tsx",
      "../../apps/web-admin/components/QualityBoard.tsx",
    ]) {
      const text = read(rel);
      assert.equal(text.includes("/thanks"), false, rel);
      assert.equal(text.includes("guest/gratitude"), false, rel);
    }
  });
});
