import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checklistProgress,
  ownGuestRequests,
  parseDepartment,
  parseRequestStatus,
  parseShift,
  planGuestRequest,
  routeGuestRequest,
  shiftLabel,
} from "./board.ts";

describe("routeGuestRequest", () => {
  it("sends linen and towels to housekeeping", () => {
    assert.equal(routeGuestRequest("Extra towels in 110 please"), "HK");
  });
  it("sends meals and allergens to the kitchen", () => {
    assert.equal(routeGuestRequest("Dairy allergy — no butter at breakfast"), "KITCHEN");
  });
  it("sends a leak to maintenance", () => {
    assert.equal(routeGuestRequest("Shower leaking onto the landing"), "MAINT");
  });
  it("honours an explicit department", () => {
    assert.equal(routeGuestRequest("Need help", "GROUNDS"), "GROUNDS");
  });
  it("defaults front of house for a general ask", () => {
    assert.equal(routeGuestRequest("Can someone call a taxi at 9?"), "FRONT");
  });
  it("sends a late door to the night porter", () => {
    assert.equal(routeGuestRequest("Locked out — can you let me in?"), "NIGHT");
  });
});

describe("allergen requests", () => {
  const depts = (text: string) => planGuestRequest(text).map(row => row.department);

  it("sends a nut allergy to the kitchen and the restaurant, not the front desk", () => {
    assert.deepEqual(depts("nut allergy"), ["KITCHEN", "RESTAURANT"]);
  });

  it("sends gluten free to the kitchen and the restaurant, not the front desk", () => {
    assert.deepEqual(depts("gluten free"), ["KITCHEN", "RESTAURANT"]);
  });

  it("does not treat wheat as a heating fault", () => {
    assert.deepEqual(depts("wheat"), ["KITCHEN", "RESTAURANT"]);
    assert.equal(routeGuestRequest("The heating is off in room 4"), "MAINT");
  });

  it("sends a peanut allergy with a clean to housekeeping without the allergen words", () => {
    const plan = planGuestRequest("peanut allergy — please clean the room");
    assert.deepEqual(plan.map(row => row.department), ["KITCHEN", "RESTAURANT", "HK"]);
    const kitchen = plan[0].request_text;
    const restaurant = plan[1].request_text;
    const house = plan[2].request_text;
    assert.match(kitchen, /peanut/i);
    assert.match(restaurant, /buffet/i);
    assert.match(restaurant, /peanut/i);
    assert.doesNotMatch(restaurant, /anaphylaxis|severe|epipen|allergy/i);
    assert.match(restaurant, /Food is not billed/);
    assert.match(house, /clean/i);
    assert.doesNotMatch(house, /peanut|allergy/i);
  });

  it("flags anaphylaxis for the kitchen and keeps that detail off the restaurant note", () => {
    const plan = planGuestRequest("anaphylaxis to nuts");
    assert.match(plan[0].request_text, /^SEVERE —/);
    assert.doesNotMatch(plan[1].request_text, /anaphylaxis|severe/i);
    assert.match(plan[1].request_text, /nut/i);
  });
});

describe("parse helpers", () => {
  it("normalises shift names", () => {
    assert.equal(parseShift("PM"), "pm");
    assert.equal(parseShift("evening"), "pm");
    assert.equal(parseShift("night"), "night");
    assert.equal(parseShift(""), "am");
    assert.equal(shiftLabel("pm"), "Evening");
    assert.equal(shiftLabel("night"), "Night");
  });
  it("falls back to whole house for unknown departments", () => {
    assert.equal(parseDepartment("nope"), "HOUSE");
    assert.equal(parseDepartment("hk"), "HK");
  });
  it("maps request status words", () => {
    assert.equal(parseRequestStatus("in_progress"), "doing");
    assert.equal(parseRequestStatus("closed"), "done");
    assert.equal(parseRequestStatus(""), "open");
  });
});

describe("checklistProgress", () => {
  it("counts ticks for the day", () => {
    assert.deepEqual(checklistProgress([{ done: true }, { done: false }, { done: true }]), { done: 2, total: 3 });
  });
});

describe("ownGuestRequests", () => {
  it("never returns another guest's ask", () => {
    const rows = [
      { guestAccountId: "a", guestEmail: "priya@example.com", text: "towels" },
      { guestAccountId: "b", guestEmail: "other@example.com", text: "taxi" },
    ];
    const mine = ownGuestRequests(rows, { id: "a", email: "priya@example.com" });
    assert.equal(mine.length, 1);
    assert.equal(mine[0].text, "towels");
  });
});
