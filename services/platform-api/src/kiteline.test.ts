import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildKitelineRequest, kitelineEnabled, minimumGuestEvent, signKitelineBody } from "./kiteline.ts";

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("kiteline guest feed", () => {
  it("is off unless explicitly enabled", () => {
    const prev = process.env.KITELINE_BACKUP;
    delete process.env.KITELINE_BACKUP;
    try {
      assert.equal(kitelineEnabled(), false);
      process.env.KITELINE_BACKUP = "false";
      assert.equal(kitelineEnabled(), false);
      process.env.KITELINE_BACKUP = "true";
      assert.equal(kitelineEnabled(), true);
    } finally { restore("KITELINE_BACKUP", prev); }
  });

  it("keeps only an id and an event type", () => {
    assert.deepEqual(minimumGuestEvent({ id: "evt-1", kind: "enquiry", name: "Hidden", email: "hidden@example.invalid", notes: "secret" }), { id: "evt-1", kind: "enquiry" });
    assert.equal(minimumGuestEvent({ id: "", kind: "enquiry" }), null);
  });

  it("signs the minimum body and refuses a short secret", () => {
    const now = new Date("2026-09-27T12:00:00.000Z");
    assert.equal(buildKitelineRequest({ id: "evt-1", kind: "enquiry", email: "hidden@example.invalid" }, "too-short", now), null);
    const req = buildKitelineRequest({ id: "evt-1", kind: "enquiry", name: "Hidden Guest", email: "hidden@example.invalid", notes: "nut allergy" }, "a-sufficiently-long-secret", now);
    assert.ok(req);
    assert.equal(req.body, JSON.stringify({ id: "evt-1", kind: "enquiry" }));
    assert.equal(req.body.includes("Hidden"), false);
    assert.equal(req.body.includes("nut"), false);
    assert.equal(req.signature, `sha256=${signKitelineBody("a-sufficiently-long-secret", now.toISOString(), req.body)}`);
    assert.match(req.url, /\/api\/vedanta\/patch$/);
  });
});
