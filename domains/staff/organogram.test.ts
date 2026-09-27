import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOrganogram, HOD_ROLES, HOUSE_DEPARTMENTS, HOUSE_POSITIONS, ROLE_NAMES } from "./organogram.ts";
import { leaveNeedsHodFirst } from "./leave-state.ts";

const house = [
  { name: "Owner Example", email: "owner@example.invalid", role: "SYSTEM_OWNER", department: "MGMT" },
  { name: "Morgan House", email: "gm.house@example.invalid", role: "GENERAL_MANAGER", department: "MGMT" },
  { name: "Rowan House", email: "estate.house@example.invalid", role: "ESTATE_MANAGER", department: "GROUNDS" },
  { name: "Riley House", email: "estate.assist@example.invalid", role: "ESTATE_ASSISTANT", department: "GROUNDS" },
  { name: "Jamie House", email: "grounds.one@example.invalid", role: "GROUNDS", department: "GROUNDS" },
  { name: "Quinn House", email: "hk.lead@example.invalid", role: "HK_SUPERVISOR", department: "HK" },
  { name: "Avery House", email: "hk.one@example.invalid", role: "HK_ATTENDANT", department: "HK" },
  { name: "Casey House", email: "hk.two@example.invalid", role: "HK_ATTENDANT", department: "HK" },
  { name: "Jordan House", email: "restaurant.lead@example.invalid", role: "RESTAURANT_MANAGER", department: "RESTAURANT" },
  { name: "Sam House", email: "restaurant.sup@example.invalid", role: "RESTAURANT_SUPERVISOR", department: "RESTAURANT" },
  { name: "Alex House", email: "restaurant.one@example.invalid", role: "RESTAURANT_STAFF", department: "RESTAURANT" },
  { name: "Taylor House", email: "sales.one@example.invalid", role: "SALES_MANAGER", department: "SALES" },
];

describe("house organogram", () => {
  it("puts the sample general manager and estate manager in their seats", () => {
    const org = buildOrganogram(house);
    const mgmt = org.departments.find(d => d.code === "MGMT")!;
    const gm = mgmt.seats.find(s => s.code === "GENERAL_MANAGER")!;
    assert.deepEqual(gm.people.map(p => p.name), ["Morgan House"]);
    const estate = org.departments.find(d => d.code === "GROUNDS")!;
    const em = estate.seats.find(s => s.code === "ESTATE_MANAGER")!;
    assert.deepEqual(em.people.map(p => p.name), ["Rowan House"]);
    assert.ok(estate.notes?.toLowerCase().includes("tractor") || estate.notes?.toLowerCase().includes("grounds"));
  });

  it("keeps housekeeping, restaurant and grounds named staff together", () => {
    const org = buildOrganogram(house);
    const hk = org.departments.find(d => d.code === "HK")!;
    assert.deepEqual(hk.seats.find(s => s.code === "HK_SUPERVISOR")!.people.map(p => p.name), ["Quinn House"]);
    assert.deepEqual(hk.seats.find(s => s.code === "HK_ATTENDANT")!.people.map(p => p.name), ["Avery House", "Casey House"]);
    const rest = org.departments.find(d => d.code === "RESTAURANT")!;
    assert.equal(rest.seats.find(s => s.code === "RESTAURANT_MANAGER")!.people[0].name, "Jordan House");
    assert.equal(rest.seats.find(s => s.code === "RESTAURANT_SUPERVISOR")!.people[0].name, "Sam House");
    assert.equal(rest.seats.find(s => s.code === "RESTAURANT_STAFF")!.people[0].name, "Alex House");
    const grounds = org.departments.find(d => d.code === "GROUNDS")!;
    assert.equal(grounds.seats.find(s => s.code === "ESTATE_ASSISTANT")!.people[0].name, "Riley House");
    assert.equal(grounds.seats.find(s => s.code === "GROUNDS")!.people[0].name, "Jamie House");
  });

  it("shows named people only — not a wall of empty posts", () => {
    const org = buildOrganogram(house);
    assert.equal(org.departments.find(d => d.code === "KITCHEN"), undefined);
    assert.ok(HOUSE_POSITIONS.some(p => p.code === "CHEF_DE_PARTIE"));
    assert.ok(HOUSE_POSITIONS.some(p => p.code === "NIGHT_PORTER"));
    const sales = org.departments.find(d => d.code === "SALES")!;
    assert.equal(sales.seats.find(s => s.code === "SALES_MANAGER")!.people[0].name, "Taylor House");
    assert.equal(sales.seats.find(s => s.code === "SALES_ASSISTANT"), undefined);
  });

  it("notes that reception runs tea and coffee", () => {
    const front = HOUSE_DEPARTMENTS.find(d => d.code === "FRONT")!;
    assert.match(front.notes ?? "", /tea and coffee/i);
  });
});

describe("holiday signatures follow the organogram", () => {
  it("ordinary restaurant and grounds staff go to the head of department first", () => {
    assert.equal(leaveNeedsHodFirst("RESTAURANT_STAFF"), true);
    assert.equal(leaveNeedsHodFirst("GROUNDS"), true);
    assert.equal(leaveNeedsHodFirst("HK_ATTENDANT"), true);
    assert.equal(leaveNeedsHodFirst("SALES_ASSISTANT"), true);
    assert.equal(leaveNeedsHodFirst("SALES_MANAGER"), false);
  });

  it("heads of department go to the general manager only", () => {
    for (const role of ["GENERAL_MANAGER", "HK_SUPERVISOR", "RESTAURANT_MANAGER", "ESTATE_MANAGER", "HEAD_CHEF", "KITCHEN_MANAGER", "OPERATIONS_MANAGER", "SALES_MANAGER"]) {
      assert.equal(leaveNeedsHodFirst(role), false, role);
      assert.ok(HOD_ROLES.has(role) || role === "GENERAL_MANAGER", role);
    }
  });

  it("labels waiter / waitress and chef de partie in words people use in the house", () => {
    assert.equal(ROLE_NAMES.RESTAURANT_STAFF, "Waiter / waitress");
    assert.equal(ROLE_NAMES.CHEF_DE_PARTIE, "Chef de partie");
    assert.equal(ROLE_NAMES.SENIOR_CHEF_DE_PARTIE, "Senior chef de partie");
  });
});
