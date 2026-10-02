import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { HARI_REMINDER } from "../house/rules.ts";
import { contactTreeSaved, dayBefore, preRetreatReadiness, purchaseMarkedPlaced, riskAssessmentSaved, type SafetyRow } from "./pre-retreat.ts";

const bookingId = "11111111-1111-4111-8111-111111111111";

function check(over: Partial<Parameters<typeof preRetreatReadiness>[0]> = {}) {
  return preRetreatReadiness({
    bookingId,
    arrival: "2026-10-04",
    departure: "2026-10-06",
    roomAssignments: 0,
    mealDates: [],
    rotaDates: [],
    purchases: [],
    safetyRows: [],
    ...over,
  });
}

const savedSafety: SafetyRow[] = [
  { kind: "incident_note", body: "Watch the lane gate on arrival evening.", signedAt: null },
  { kind: "pre_arrival", body: "Fire exit by the dining room is clear. First aid box is in reception. Night contact is the duty manager.", signedAt: null },
  { kind: "risk_assessment", body: `${HARI_REMINDER}\nKitchen: hot water urn stays behind the service pass.`, signedAt: null },
  { kind: "first_aid", body: "Box in reception checked.", signedAt: "2026-10-03T09:00:00Z" },
  { kind: "contact", body: "Duty manager | 07700900123", signedAt: null },
];

test("every line stays open when no record exists", () => {
  const view = check();
  assert.equal(view.dayBefore, "2026-10-03");
  assert.equal(view.ready, false);
  assert.deepEqual(view.lines.map(l => l.state), ["open", "open", "open", "open", "open"]);
  assert.ok(view.safetyParts.every(p => p.state === "open"));
});

test("a retreat name cannot pass the check", () => {
  const src = readFileSync(new URL("./pre-retreat.ts", import.meta.url), "utf8");
  assert.equal(src.includes("Phoenix"), false);
  assert.equal(check().ready, false);
});

test("rooms are done only from a room-board assignment", () => {
  assert.equal(check().lines.find(l => l.key === "rooms")!.state, "open");
  assert.equal(check({ roomAssignments: 2 }).lines.find(l => l.key === "rooms")!.state, "done");
});

test("meals stay open until a menu or meal-count record covers each date", () => {
  assert.match(check({ mealDates: ["2026-10-04"] }).lines.find(l => l.key === "meals")!.detail, /2026-10-05, 2026-10-06/);
  assert.equal(check({ mealDates: ["2026-10-04", "2026-10-05", "2026-10-06"] }).lines.find(l => l.key === "meals")!.state, "done");
});

test("rota stays open until every retreat date has a shift", () => {
  assert.equal(check({ rotaDates: ["2026-10-04", "2026-10-05"] }).lines.find(l => l.key === "rota")!.state, "open");
  assert.equal(check({ rotaDates: ["2026-10-04", "2026-10-05", "2026-10-06"] }).lines.find(l => l.key === "rota")!.state, "done");
});

test("suppliers are done only when a purchase for this retreat is marked placed", () => {
  assert.equal(purchaseMarkedPlaced("approved"), false);
  assert.equal(purchaseMarkedPlaced("submitted"), false);
  assert.equal(purchaseMarkedPlaced("cancelled"), false);
  assert.equal(purchaseMarkedPlaced("ordered"), true);
  assert.equal(purchaseMarkedPlaced("sent"), true);
  const other = "22222222-2222-4222-8222-222222222222";
  assert.equal(check({ purchases: [{ status: "sent", bookingId: other }] }).lines.find(l => l.key === "suppliers")!.state, "open");
  assert.equal(check({ purchases: [{ status: "approved", bookingId }] }).lines.find(l => l.key === "suppliers")!.state, "open");
  assert.equal(check({ purchases: [{ status: "ordered", bookingId }] }).lines.find(l => l.key === "suppliers")!.state, "done");
});

test("health and safety stays open on a blank template and on 999 alone", () => {
  assert.equal(riskAssessmentSaved(""), false);
  assert.equal(riskAssessmentSaved("Kitchen"), false);
  assert.equal(riskAssessmentSaved(HARI_REMINDER), false);
  assert.equal(contactTreeSaved([{ name: "Emergency services", phone: "999" }]), false);
  const blank: SafetyRow[] = [
    { kind: "incident_note", body: "   ", signedAt: null },
    { kind: "pre_arrival", body: "", signedAt: null },
    { kind: "risk_assessment", body: HARI_REMINDER, signedAt: null },
    { kind: "first_aid", body: "Box in reception", signedAt: null },
    { kind: "contact", body: "Emergency services | 999", signedAt: null },
  ];
  const view = check({ safetyRows: blank });
  assert.ok(view.safetyParts.every(p => p.state === "open"));
  assert.equal(view.lines.find(l => l.key === "safety")!.state, "open");
});

test("health and safety is done only when every saved record for the retreat is present", () => {
  const missingAid = savedSafety.filter(r => r.kind !== "first_aid");
  assert.equal(check({ safetyRows: missingAid }).lines.find(l => l.key === "safety")!.state, "open");
  const view = check({
    roomAssignments: 1,
    mealDates: ["2026-10-04", "2026-10-05", "2026-10-06"],
    rotaDates: ["2026-10-04", "2026-10-05", "2026-10-06"],
    purchases: [{ status: "sent", bookingId }],
    safetyRows: savedSafety,
  });
  assert.equal(view.ready, true);
  assert.ok(view.lines.every(l => l.state === "done"));
});

test("day before an arrival is the previous calendar date", () => {
  assert.equal(dayBefore("2026-10-01"), "2026-09-30");
  assert.equal(dayBefore("not-a-date"), null);
});
