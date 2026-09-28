import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  heldTooLong,
  matchScore,
  nextLostStatus,
  parseFoundItem,
  parseLostSettings,
  parseMissingReport,
  parseStatusChange,
  suggestMatches,
} from "./lostFound.ts";

describe("lost and found status", () => {
  it("allows a claim and a return, and refuses a jump", () => {
    assert.equal(nextLostStatus("logged", "claimed"), "claimed");
    assert.equal(nextLostStatus("logged", "returned"), null);
    const returned = parseStatusChange({ status: "returned", claimant_name: "A Guest", return_method: "posted" }, "claimed");
    assert.equal(returned.ok, true);
    if (returned.ok) assert.equal(returned.method, "posted");
    assert.equal(parseStatusChange({ status: "returned", claimant_name: "A Guest" }, "claimed").ok, false);
  });
});

describe("lost and found matches", () => {
  it("prefers the same words, category, place, and a close date", () => {
    const report = { description: "Black wool scarf", category: "clothing", place: "Room 12", happened_on: "2026-09-20" };
    const close = { id: "a", description: "Black scarf on the chair", category: "clothing", place: "Room 12", found_on: "2026-09-21", status: "logged" };
    const far = { id: "b", description: "Phone charger", category: "electronics", place: "Halls", found_on: "2026-01-01", status: "logged" };
    const gone = { ...close, id: "c", status: "returned" };
    assert.equal(matchScore(report, close) > matchScore(report, far), true);
    assert.equal(matchScore(report, gone), 0);
    assert.deepEqual(suggestMatches(report, [far, close, gone]).map(item => item.id), ["a"]);
  });
});

describe("lost and found retention", () => {
  it("flags an item held past the limit and clears the setting of a bad email", () => {
    assert.equal(heldTooLong("2026-06-01", "2026-09-28", 90, "logged"), true);
    assert.equal(heldTooLong("2026-09-01", "2026-09-28", 90, "logged"), false);
    assert.equal(heldTooLong("2026-01-01", "2026-09-28", 90, "returned"), false);
    assert.equal(parseLostSettings({ hold_days: 2, manager: "not an email" }).hold_days, 7);
    assert.equal(parseLostSettings({}).hold_days, 90);
  });

  it("asks for a description and a place", () => {
    assert.equal(parseFoundItem({ description: "Scarf", category: "clothing", found_on: "2026-09-01" }).ok, false);
    const found = parseFoundItem({ description: "Black scarf", category: "clothing", place: "Room 12", found_on: "2026-09-01", storage: "Front desk drawer" });
    assert.equal(found.ok, true);
    assert.equal(parseMissingReport({ description: "Scarf", category: "clothing", contact_email: "not-an-email" }).ok, false);
    const report = parseMissingReport({ description: "Black scarf", category: "clothing", contact_email: "guest@example.invalid" });
    assert.equal(report.ok, true);
  });
});
