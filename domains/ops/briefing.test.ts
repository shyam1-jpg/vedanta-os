import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BRIEFING_LINKS,
  DEFAULT_RULES,
  NOTHING,
  briefingView,
  buildBriefing,
  isColdFault,
  parseWatchRules,
  scoreWatch,
  topWatch,
  type BriefingFacts,
  type BriefingStay,
  type Mark,
  type WatchRules,
} from "./briefing.ts";
import { NOTHING as AUDIT_NOTHING } from "./nightAudit.ts";

const TODAY = "2026-09-28";

function stay(over: Partial<BriefingStay> = {}): BriefingStay {
  return {
    id: "stay-1",
    firstName: "Asha",
    room: "4",
    party: 2,
    movement: "arrival",
    returning: false,
    severe: false,
    access: false,
    vip: false,
    flagged: false,
    allergens: [],
    ...over,
  };
}

function facts(over: Partial<BriefingFacts> = {}): BriefingFacts {
  return {
    date: TODAY,
    stays: [],
    shifts: [],
    shiftsKnown: true,
    tickets: [],
    issues: [],
    stock: [],
    compliance: [],
    training: [],
    deliveries: [],
    notes: [],
    ...over,
  };
}

function board(over: Partial<BriefingFacts> = {}, view: "kitchen" | "house" = "house", rules: WatchRules = { ...DEFAULT_RULES, heads: {} }, marks: Mark[] = []) {
  return buildBriefing({ facts: facts(over), view, rules, marks, userId: "user-1" });
}

describe("briefing scorer", () => {
  it("ranks a severe allergen above a day that is only low on stock, and names the rule", () => {
    const quiet = scoreWatch(facts({
      shiftsKnown: false,
      stock: [{ id: "s", name: "Rice", quantity: 1, unit: "kg", low: 4 }],
    }), DEFAULT_RULES);
    assert.equal(quiet.length, 0);

    const scored = scoreWatch(facts({
      stays: [stay({ severe: true, allergens: ["peanut"] })],
      shiftsKnown: false,
      stock: [{ id: "s", name: "Rice", quantity: 0, unit: "kg", low: 4 }],
    }), DEFAULT_RULES);
    assert.equal(scored[0].rule, "severe");
    assert.equal(scored[0].points, 100);
    assert.match(scored[0].whyHouse, /Rule: severe allergen/);
    assert.doesNotMatch(scored[0].whyHouse, /peanut/i);
    assert.match(scored[0].whyKitchen, /peanut/);
  });

  it("scores a fridge or freezer fault, a VIP arrival, a flagged returning guest, and overdue compliance", () => {
    const scored = scoreWatch(facts({
      shiftsKnown: false,
      stays: [
        stay({ id: "vip", vip: true }),
        stay({ id: "flag", flagged: true, returning: true, firstName: "Dev" }),
        stay({ id: "plain", firstName: "Guest" }),
        stay({ id: "flag-new", flagged: true, returning: false, firstName: "New" }),
      ],
      tickets: [
        { id: "t1", number: "M-1", title: "Walk-in freezer warm", priority: "URGENT", status: "OPEN", ageDays: 1, location: "Kitchen" },
        { id: "t2", number: "M-2", title: "Door hinge", priority: "NORMAL", status: "OPEN", ageDays: 1, location: "Room 2" },
      ],
      compliance: [
        { id: "c1", title: "Fire alarm", dueOn: "2026-09-27" },
        { id: "c2", title: "Water check", dueOn: TODAY },
      ],
    }), DEFAULT_RULES);
    const rules = scored.map(item => item.rule);
    assert.ok(rules.includes("cold"));
    assert.ok(rules.includes("vip"));
    assert.ok(rules.includes("compliance"));
    assert.equal(scored.filter(item => item.rule === "vip").length, 2);
    assert.ok(scored.some(item => item.title.includes("Dev")));
    assert.equal(scored.some(item => item.key.includes("plain") || item.key.includes("flag-new")), false);
    assert.equal(isColdFault("Door hinge", "Room 2"), false);
    assert.equal(isColdFault("Fridge", "Stores"), true);
  });

  it("scores an in-house severe allergen even when they are not arriving today", () => {
    const scored = scoreWatch(facts({
      shiftsKnown: false,
      stays: [stay({ id: "in", movement: "in_house", severe: true, allergens: ["peanut"] })],
    }), DEFAULT_RULES);
    assert.equal(scored.length, 1);
    assert.match(scored[0].whyHouse, /in house/);
    assert.doesNotMatch(scored[0].whyHouse, /peanut/i);
    const built = board({ stays: [stay({ id: "in", movement: "in_house", severe: true, allergens: ["peanut"] })] });
    assert.equal(built.sections.find(section => section.key === "stays")?.lines[0].text, NOTHING);
    assert.equal(built.watch.length, 1);
  });

  it("flags understaffing against the rota requirement", () => {
    const scored = scoreWatch(facts({
      shifts: [{ id: "sh", userId: "one", department: "Kitchen", firstName: "Porter", start: "07:00", end: "15:00", swapped: false }],
    }), DEFAULT_RULES);
    const gap = scored.find(item => item.rule === "staffing");
    assert.ok(gap);
    assert.match(gap.whyHouse, /Rule: understaffing/);
    assert.match(gap.whyHouse, /Kitchen has 1 on shift/);
    assert.match(gap.whyHouse, /asks for 2/);
  });

  it("does not invent understaffing when the rota could not be read", () => {
    const scored = scoreWatch(facts({ shiftsKnown: false, shifts: [] }), DEFAULT_RULES);
    assert.equal(scored.some(item => item.rule === "staffing"), false);
  });

  it("lets a pin force an item into the three, and a dismiss remove it unless it is also pinned", () => {
    const scored = scoreWatch(facts({
      stays: [stay({ id: "sev", severe: true })],
      tickets: [{ id: "cold", number: "M-9", title: "Freezer", priority: "URGENT", status: "OPEN", ageDays: 0, location: "Kitchen" }],
      compliance: [{ id: "late", title: "Gas", dueOn: "2026-09-01" }],
      shifts: [],
      shiftsKnown: true,
    }), DEFAULT_RULES);
    const open = topWatch(scored, [], "house").map(item => item.rule);
    assert.deepEqual(open, ["severe", "cold", "compliance"]);
    const pinned = topWatch(scored, [{ key: "staff:KITCHEN", action: "pin" }, { key: "severe:sev", action: "dismiss" }], "house");
    assert.equal(pinned[0].key, "staff:KITCHEN");
    assert.equal(pinned[0].pinned, true);
    assert.equal(pinned.some(item => item.rule === "severe"), false);
    const forced = topWatch(scored, [
      { key: "staff:KITCHEN", action: "pin" },
      { key: "cold:cold", action: "dismiss" },
      { key: "cold:cold", action: "pin" },
    ], "house");
    assert.equal(forced[0].pinned || forced[1].pinned, true);
    assert.ok(forced.some(item => item.key === "cold:cold" && item.pinned));
    assert.equal(forced.length <= 3, true);
  });
});

describe("briefing role filter", () => {
  it("shows allergen codes to kitchen and only the flag to the house", () => {
    const stays = [stay({ severe: true, allergens: ["peanut"], access: true, returning: true })];
    const kitchen = board({ stays }, "kitchen");
    const house = board({ stays }, "house");
    const kitchenText = JSON.stringify(kitchen);
    const houseText = JSON.stringify(house);
    assert.match(kitchenText, /peanut/);
    assert.doesNotMatch(houseText, /peanut/i);
    assert.match(houseText, /severe allergen/);
    assert.match(house.watch[0].why, /Rule: severe allergen/);
    assert.equal(briefingView({ role: "HEAD_CHEF", department: "FRONT", perms: [] }), "kitchen");
    assert.equal(briefingView({ role: "GENERAL_MANAGER", department: "FRONT", perms: [] }), "house");
    assert.equal(briefingView({ role: "FRONT_OFFICE", department: "KITCHEN", perms: [] }), "kitchen");
    assert.equal(briefingView({ role: "FRONT_OFFICE", department: null, perms: ["guest.profile.kitchen"] }), "kitchen");
  });
});

describe("briefing aggregation", () => {
  it("fills every section, including an empty board, and keeps a swapped shift under the new person", () => {
    const empty = board();
    assert.equal(empty.sections.length, 9);
    for (const section of empty.sections) assert.equal(section.lines[0].text, AUDIT_NOTHING);

    const full = board({
      stays: [
        stay({ id: "a", movement: "arrival", returning: true, access: true }),
        stay({ id: "d", movement: "departure", firstName: "Dev" }),
      ],
      shifts: [{ id: "sh", userId: "porter", department: "KITCHEN", firstName: "Porter", start: "07:00", end: "15:00", swapped: true }],
      tickets: [{ id: "t", number: "M-4", title: "Tap", priority: "NORMAL", status: "OPEN", ageDays: 9, location: "Room 1" }],
      issues: [{ id: "i", label: "complaint", overdue: false }],
      stock: [{ id: "s", name: "Rice", quantity: 1, unit: "kg", low: 5 }],
      compliance: [{ id: "c", title: "Fire alarm", dueOn: TODAY }],
      training: [{ id: "tr", firstName: "Porter", title: "Food hygiene", expiresOn: "2026-10-02" }],
      deliveries: [{ id: "del", supplier: "Example Supplier", detail: "produce" }],
      notes: [
        { id: "n1", author: "Dev", department: "FRONT", shift: "night", excerpt: "Boiler checked", ackedBy: [] },
        { id: "n2", author: "Dev", department: "FRONT", shift: "night", excerpt: "Already read", ackedBy: ["user-1"] },
      ],
    }, "house", { ...DEFAULT_RULES, heads: { KITCHEN: 1, FRONT: 0 } });

    const text = JSON.stringify(full);
    assert.match(text, /Arriving · Asha/);
    assert.match(text, /returning/);
    assert.match(text, /accessibility/);
    assert.match(text, /Departing · Dev/);
    assert.match(text, /Porter · 07:00–15:00 · swapped/);
    assert.match(text, /overdue/);
    assert.match(text, /Guest complaint/);
    assert.match(text, /Rice/);
    assert.match(text, /due today/);
    assert.match(text, /Food hygiene/);
    assert.match(text, /Example Supplier/);
    assert.match(text, /Boiler checked/);
    assert.equal(text.includes("Already read"), false);
    assert.equal(full.sections.find(section => section.key === "stays")?.href, BRIEFING_LINKS.stays);
    assert.equal(NOTHING, "Nothing to report.");
  });

  it("reads house points and falls back when a setting is not a number", () => {
    const rules = parseWatchRules({ severe: "40", cold: -1, heads: { kitchen: 3, front: "nope" } });
    assert.equal(rules.severe, 40);
    assert.equal(rules.cold, DEFAULT_RULES.cold);
    assert.equal(rules.heads.KITCHEN, 3);
    assert.equal(rules.heads.FRONT, DEFAULT_HEADS_FRONT());
  });
});

function DEFAULT_HEADS_FRONT(): number {
  return DEFAULT_RULES.heads.FRONT;
}
