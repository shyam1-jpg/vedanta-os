import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chooseTags,
  handoverWindow,
  noteVisible,
  staffTagCodes,
  tagsOrDefault,
  windowLabel,
} from "./handover.ts";

const tags = tagsOrDefault(undefined);

describe("handover tags", () => {
  it("keeps the four house tags until settings replaces them", () => {
    assert.deepEqual(tags.map(t => t.label), ["Kitchen", "Front of house", "Maintenance", "General"]);
    assert.deepEqual(tagsOrDefault(["Boiler", "Boiler"]).map(t => t.code), ["boiler"]);
  });

  it("accepts a known tag and refuses one that is not on the list", () => {
    assert.deepEqual(chooseTags(["Kitchen", "general"], tags), { ok: true, tags: ["kitchen", "general"] });
    const bad = chooseTags(["onion"], tags);
    assert.equal(bad.ok, false);
  });

  it("shows a kitchen note to the kitchen, a general note to everyone, and not a chair note to the kitchen only", () => {
    const kitchen = staffTagCodes("KITCHEN", "KITCHEN");
    const front = staffTagCodes("FRONT", "RECEPTIONIST");
    assert.equal(noteVisible({ tags: ["kitchen"], department: "KITCHEN" }, kitchen), true);
    assert.equal(noteVisible({ tags: ["kitchen"], department: "KITCHEN" }, front), false);
    assert.equal(noteVisible({ tags: ["general"], department: "HOUSE" }, front), true);
    assert.equal(noteVisible({ tags: [], department: "KITCHEN" }, kitchen), true);
    assert.equal(noteVisible({ tags: [], department: "NIGHT" }, front), true);
    assert.equal(staffTagCodes("HK", "GENERAL_MANAGER"), "all");
  });
});

describe("handover window", () => {
  const now = new Date("2026-09-28T08:00:00Z");

  it("uses the rota shift, including notes written before the person starts", () => {
    const shiftStart = new Date("2026-09-28T07:00:00Z");
    const window = handoverWindow({ shiftStart, previousLogin: new Date("2026-09-27T08:00:00Z"), now });
    assert.equal(window.reason, "shift");
    assert.equal(window.since.toISOString(), new Date(shiftStart.getTime() - 14 * 60 * 60 * 1000).toISOString());
    assert.equal(windowLabel(window.reason).includes("shift"), true);
  });

  it("uses the previous sign-in when there is no shift", () => {
    const previousLogin = new Date("2026-09-27T18:00:00Z");
    const window = handoverWindow({ shiftStart: null, previousLogin, now });
    assert.equal(window.reason, "login");
    assert.equal(window.since.toISOString(), previousLogin.toISOString());
  });

  it("falls back to the last 18 hours on a first sign-in", () => {
    const window = handoverWindow({ now });
    assert.equal(window.reason, "recent");
    assert.equal(window.since.toISOString(), new Date(now.getTime() - 18 * 60 * 60 * 1000).toISOString());
  });
});
