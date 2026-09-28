import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  acceptWarning,
  bookingEmails,
  cancellationEmails,
  captureFromStored,
  DEFAULT_ROUTING_RULES,
  depositFollowUp,
  departmentSlices,
  dietarySummary,
  formatSlice,
  frontSlice,
  housekeepingSlice,
  highestSeverity,
  kitchenSlice,
  mealsOn,
  parseRoutingRules,
  reconcileRoutes,
  resendAccessCode,
  restaurantSlice,
  roomPersonPlan,
  taskPriority,
  validateCapture,
  type PartyGuest,
  type StayCapture,
} from "./booking.ts";

const rules = {
  kitchen: { enabled: true, email: "kitchen@example.invalid" },
  restaurant: { enabled: true, email: "restaurant@example.invalid" },
  front: { enabled: true, email: "front@example.invalid" },
};

function guest(over: Partial<PartyGuest> = {}): PartyGuest {
  return {
    given_name: "Ada",
    family_name: "Lovelace",
    diet: ["vegan"],
    allergens: [{ code: "peanuts", severity: "ANAPHYLAXIS" }],
    other: "EPI-PEN-TOKEN",
    accessibility: null,
    plate: "prepared",
    ...over,
  };
}

function stay(over: Partial<StayCapture> = {}): StayCapture {
  return {
    people: 2,
    name: "Ada Lovelace",
    email: "ada@example.invalid",
    arrival: "2026-10-02",
    departure: "2026-10-04",
    arrival_slot: "PM",
    departure_slot: "AM",
    party: [
      guest(),
      guest({
        given_name: "Grace",
        family_name: "Hopper",
        diet: ["gluten_free"],
        allergens: [{ code: "cereals_gluten", severity: "INTOLERANCE" }],
        other: null,
        accessibility: "WHEELCHAIR-TOKEN",
        plate: "buffet",
      }),
    ],
    accessibility_notes: "WHEELCHAIR-TOKEN",
    arrival_time_note: "ARRIVAL-TOKEN-1630",
    room_preference: "QUIET-GARDEN-ROOM",
    travel_notes: "TAXI-TOKEN",
    notes: "GUEST-NOTE-TOKEN",
    ...over,
  };
}

describe("guest booking capture", () => {
  it("requires a severity for each ticked allergen and a row per person", () => {
    const bad = validateCapture({
      name: "Ada Lovelace",
      email: "ada@example.invalid",
      people: 1,
      arrival: "2026-10-02",
      departure: "2026-10-04",
      party: [{ given_name: "Ada", family_name: "Lovelace", allergens: ["peanuts"] }],
    });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.match(bad.errors.join(" "), /how serious/i);

    const short = validateCapture({
      name: "Ada Lovelace",
      email: "ada@example.invalid",
      people: 2,
      arrival: "2026-10-02",
      departure: "2026-10-04",
      party: [{ given_name: "Ada", family_name: "Lovelace", diet: ["vegan"], allergens: [] }],
    });
    assert.equal(short.ok, false);
    if (!short.ok) assert.match(short.errors.join(" "), /every person/i);
  });

  it("keeps the 14 allergens, per-person severity, diet and other text", () => {
    const result = validateCapture({
      name: "Ada Lovelace",
      email: "Ada@Example.invalid",
      people: 1,
      arrival: "2026-10-02",
      departure: "2026-10-04",
      arrival_time_note: "16:30",
      room_preference: "ground floor",
      accessibility_notes: "step-free",
      notes: "quiet",
      party: [{
        given_name: "Ada",
        family_name: "Lovelace",
        diet: ["vegan", "vegetarian"],
        allergens: [{ code: "peanuts", severity: "ANAPHYLAXIS" }, { code: "milk", severity: "PREFERENCE" }],
        other: "carries an EpiPen",
        plate: "prepared",
      }],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.capture.email, "ada@example.invalid");
    assert.equal(result.capture.party[0].allergens[0].severity, "ANAPHYLAXIS");
    assert.equal(result.capture.party[0].allergens[1].severity, "PREFERENCE");
    assert.deepEqual(result.capture.party[0].diet, ["vegan", "vegetarian"]);
    assert.equal(result.capture.party[0].other, "carries an EpiPen");
    assert.equal(highestSeverity(["PREFERENCE", "ANAPHYLAXIS", "ALLERGY"]), "ANAPHYLAXIS");
  });

  it("rejects an allergen outside the UK 14", () => {
    const result = validateCapture({
      name: "Ada Lovelace",
      email: "ada@example.invalid",
      people: 1,
      arrival: "2026-10-02",
      departure: "2026-10-04",
      party: [{ given_name: "Ada", family_name: "Lovelace", allergens: [{ code: "kiwi", severity: "ALLERGY" }] }],
    });
    assert.equal(result.ok, false);
  });
});

describe("accept carry-over", () => {
  it("carries a complete party with nothing dropped", () => {
    const stored = captureFromStored(stay());
    assert.deepEqual(stored.loss, []);
    assert.equal(acceptWarning(stored.loss), null);
    const summary = dietarySummary(stored.capture);
    assert.match(summary ?? "", /peanuts/i);
    assert.match(summary ?? "", /ANAPHYLAXIS/);
    assert.match(summary ?? "", /Grace Hopper/);
  });

  it("warns when unnamed people or a loose diet note would not reach a person", () => {
    const stored = captureFromStored({
      name: "Ada Lovelace",
      email: "ada@example.invalid",
      people: 3,
      arrival: "2026-10-02",
      departure: "2026-10-04",
      dietary_notes: "nut allergy somewhere in the party",
      party: [{ given_name: "Ada", family_name: "Lovelace", diet: ["vegan"], allergens: [] }],
    });
    assert.equal(stored.loss.length, 2);
    assert.match(acceptWarning(stored.loss) ?? "", /kitchen cannot see/i);
  });

  it("attaches a legacy free-text diet to the booker when no party was stored", () => {
    const stored = captureFromStored({
      name: "Ada Lovelace",
      email: "ada@example.invalid",
      people: 1,
      arrival: "2026-10-02",
      departure: "2026-10-04",
      dietary_notes: "vegan, no nuts",
      accessibility_notes: "ground floor",
      room_preference: "quiet",
      arrival_time_note: "16:30",
    });
    assert.deepEqual(stored.loss, []);
    assert.equal(stored.capture.party[0].other, "vegan, no nuts");
    assert.equal(stored.capture.accessibility_notes, "ground floor");
    assert.equal(stored.capture.room_preference, "quiet");
    assert.equal(stored.capture.arrival_time_note, "16:30");
  });
});

describe("department slices", () => {
  const sample = stay();

  it("gives the kitchen allergens, diets and severity for each day of the stay", () => {
    const kitchen = kitchenSlice(sample);
    assert.ok(kitchen);
    assert.equal(kitchen!.severe, true);
    const ada = kitchen!.people.find(p => p.name === "Ada Lovelace");
    assert.ok(ada);
    assert.equal(ada!.allergens[0].severity, "ANAPHYLAXIS");
    assert.deepEqual(ada!.days.map(d => [d.date, d.meals]), [
      ["2026-10-02", ["dinner"]],
      ["2026-10-03", ["breakfast", "lunch", "dinner"]],
      ["2026-10-04", ["breakfast"]],
    ]);
    assert.equal(mealsOn(sample, "2026-10-01").length, 0);
    assert.match(formatSlice(kitchen!), /SEVERE — anaphylaxis/);
    assert.equal(taskPriority(kitchen!).priority, "urgent");
  });

  it("gives the restaurant meal counts, prepared plates and seating help only", () => {
    const restaurant = restaurantSlice(sample);
    assert.equal(restaurant.days[0].meals[0].meal, "dinner");
    assert.equal(restaurant.days[0].meals[0].covers, 2);
    assert.ok(restaurant.days[1].meals.some(m => m.diets.some(d => d.code === "vegan" && d.count === 1)));
    assert.equal(restaurant.plates.length, 1);
    assert.equal(restaurant.plates[0].name, "Ada Lovelace");
    assert.match(restaurant.seating.map(s => s.need).join(" "), /WHEELCHAIR-TOKEN/);
    const text = formatSlice(restaurant);
    assert.match(text, /prepared plate/);
    assert.doesNotMatch(text, /QUIET-GARDEN-ROOM/);
    assert.doesNotMatch(text, /TAXI-TOKEN/);
    assert.doesNotMatch(text, /GUEST-NOTE-TOKEN/);
  });

  it("gives front of house arrival, room, access and notes, not the allergen list", () => {
    const front = frontSlice(sample);
    const text = formatSlice(front);
    assert.match(text, /ARRIVAL-TOKEN-1630/);
    assert.match(text, /QUIET-GARDEN-ROOM/);
    assert.match(text, /WHEELCHAIR-TOKEN/);
    assert.match(text, /GUEST-NOTE-TOKEN/);
    assert.match(text, /TAXI-TOKEN/);
    assert.doesNotMatch(text, /peanuts/i);
    assert.doesNotMatch(text, /EPI-PEN-TOKEN/);
    assert.doesNotMatch(text, /ANAPHYLAXIS/);
  });

  it("omits a department when its routing rule is off", () => {
    const slices = departmentSlices(sample, { ...rules, kitchen: { enabled: false, email: rules.kitchen.email } });
    assert.deepEqual(slices.map(s => s.department), ["RESTAURANT", "FRONT", "HK"]);
  });
});

describe("structured diet and access", () => {
  it("stores diet, allergen and access codes, and flags free text for review", () => {
    const result = validateCapture({
      name: "Ada Lovelace",
      email: "ada@example.invalid",
      people: 1,
      arrival: "2026-10-02",
      departure: "2026-10-04",
      access: ["step_free", "ground_floor", "not_a_code"],
      access_note: "Example ramp note",
      party: [{
        given_name: "Ada",
        family_name: "Lovelace",
        diet: ["vegetarian", "sattvic", "low_fodmap", "diabetic_friendly", "nut_free"],
        allergens: [{ code: "cereals_gluten", severity: "ALLERGY" }, { code: "other", severity: "ANAPHYLAXIS", adrenaline_pen: true }],
        allergen_other: "Example seed",
        other: "Example diet note",
      }],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.capture.party[0].diet, ["vegetarian", "sattvic", "low_fodmap", "diabetic_friendly", "nut_free"]);
    assert.equal(result.capture.party[0].allergens[1].adrenaline_pen, true);
    assert.equal(result.capture.party[0].allergen_other, "Example seed");
    assert.deepEqual(result.capture.access, ["step_free", "ground_floor"]);
    const kitchen = kitchenSlice(result.capture)!;
    const text = formatSlice(kitchen);
    assert.match(text, /carries an adrenaline pen/);
    assert.match(text, /review before service/i);
    assert.match(text, /Example seed/);
    assert.doesNotMatch(text, /step-free/i);
    const house = formatSlice(departmentSlices(result.capture).find(s => s.department === "HK")!);
    const front = formatSlice(frontSlice(result.capture));
    assert.match(house, /Step-free access/);
    assert.match(house, /Ground-floor room/);
    assert.match(house, /Example ramp note/);
    assert.match(house, /review before service/i);
    assert.doesNotMatch(house, /Example seed/);
    assert.doesNotMatch(house, /cereals/i);
    assert.match(front, /Step-free access/);
    assert.doesNotMatch(front, /Example seed/);
    assert.doesNotMatch(front, /anaphylaxis/i);
    const restaurant = formatSlice(restaurantSlice(result.capture));
    assert.match(restaurant, /Sattvic|Low-FODMAP|Diabetic-friendly|No nuts/);
    assert.doesNotMatch(restaurant, /Step-free access/);
  });

  it("refuses an other allergen with no description, and does not treat vegetarian as a special request", () => {
    const missing = validateCapture({
      name: "Ada Lovelace",
      email: "ada@example.invalid",
      people: 1,
      arrival: "2026-10-02",
      departure: "2026-10-04",
      party: [{ given_name: "Ada", family_name: "Lovelace", allergens: [{ code: "other", severity: "ALLERGY" }] }],
    });
    assert.equal(missing.ok, false);
    const plain = validateCapture({
      name: "Ada Lovelace",
      email: "ada@example.invalid",
      people: 1,
      arrival: "2026-10-02",
      departure: "2026-10-04",
      party: [{ given_name: "Ada", family_name: "Lovelace", diet: ["vegetarian"] }],
    });
    assert.equal(plain.ok, true);
    if (!plain.ok) return;
    assert.equal(kitchenSlice(plain.capture), null);
    assert.equal(housekeepingSlice(plain.capture), null);
  });
});

describe("amend and cancel routing", () => {
  it("updates slices when the stay dates change and withdraws when a department is turned off", () => {
    const first = kitchenSlice(stay())!;
    const later = kitchenSlice(stay({ departure: "2026-10-05" }))!;
    assert.notDeepEqual(first.people[0].days.map(d => d.date), later.people[0].days.map(d => d.date));
    const plan = reconcileRoutes(
      [
        { department: "KITCHEN", status: "new" },
        { department: "RESTAURANT", status: "in_progress" },
        { department: "FRONT", status: "cancelled" },
      ],
      ["KITCHEN", "FRONT"],
    );
    assert.deepEqual(plan.update, ["KITCHEN"]);
    assert.deepEqual(plan.create, ["FRONT"]);
    assert.deepEqual(plan.withdraw, ["RESTAURANT"]);
  });

  it("withdraws every open department when the stay is cancelled", () => {
    const plan = reconcileRoutes(
      [
        { department: "KITCHEN", status: "new" },
        { department: "RESTAURANT", status: "assigned" },
        { department: "FRONT", status: "completed" },
      ],
      [],
    );
    assert.deepEqual(plan.withdraw.sort(), ["FRONT", "KITCHEN", "RESTAURANT"]);
    assert.deepEqual(plan.create, []);
  });
});

describe("email payloads", () => {
  it("sends the guest their allergens and each department only its own slice", () => {
    const notes = bookingEmails(stay(), rules, "The Vedanta");
    const guest = notes.find(n => n.audience === "GUEST")!;
    const kitchen = notes.find(n => n.audience === "KITCHEN")!;
    const restaurant = notes.find(n => n.audience === "RESTAURANT")!;
    const front = notes.find(n => n.audience === "FRONT")!;
    assert.match(guest.body, /peanuts/i);
    assert.match(guest.body, /ANAPHYLAXIS — severe/);
    assert.match(guest.body, /EPI-PEN-TOKEN/);
    assert.match(kitchen.body, /SEVERE/);
    assert.match(kitchen.body, /peanuts/i);
    assert.doesNotMatch(kitchen.body, /QUIET-GARDEN-ROOM/);
    assert.doesNotMatch(kitchen.body, /TAXI-TOKEN/);
    assert.doesNotMatch(kitchen.body, /GUEST-NOTE-TOKEN/);
    assert.match(restaurant.body, /prepared plate/);
    assert.doesNotMatch(restaurant.body, /QUIET-GARDEN-ROOM/);
    assert.doesNotMatch(restaurant.body, /TAXI-TOKEN/);
    assert.match(front.body, /ARRIVAL-TOKEN-1630/);
    assert.doesNotMatch(front.body, /peanuts/i);
    assert.doesNotMatch(front.body, /EPI-PEN-TOKEN/);
    assert.equal(kitchen.to, "kitchen@example.invalid");
  });

  it("does not invent a department email when settings are blank", () => {
    const notes = bookingEmails(stay(), DEFAULT_ROUTING_RULES, "The Vedanta");
    assert.deepEqual(notes.map(n => n.audience), ["GUEST"]);
  });

  it("cancellation notes tell departments to stand down without a fresh allergen list for the desk", () => {
    const notes = cancellationEmails(stay(), rules, "The Vedanta");
    const front = notes.find(n => n.audience === "FRONT")!;
    assert.match(front.body, /cancelled/i);
    assert.doesNotMatch(front.body, /peanuts/i);
    assert.match(notes.find(n => n.audience === "GUEST")!.body, /cancelled/i);
  });

  it("keeps routing rules editable and ignores a badly formed address", () => {
    const parsed = parseRoutingRules({
      kitchen: { enabled: false, email: "chef@example.invalid" },
      restaurant: { enabled: true, email: "not an email" },
      front: { email: "desk@example.invalid" },
    });
    assert.equal(parsed.kitchen.enabled, false);
    assert.equal(parsed.kitchen.email, "chef@example.invalid");
    assert.equal(parsed.restaurant.email, "");
    assert.equal(parsed.front.enabled, true);
    assert.equal(parsed.front.email, "desk@example.invalid");
  });
});

describe("room links and the two confirmed bugs", () => {
  it("links each guest-book room to a person so the kitchen can see them", () => {
    const people = [{ id: "p1", label: "Ada Lovelace" }, { id: "p2", label: "Grace Hopper" }];
    assert.deepEqual(roomPersonPlan(["12"], people, "Ada"), [
      { room: "12", personId: "p1", label: "Ada Lovelace" },
      { room: "12", personId: "p2", label: "Grace Hopper" },
    ]);
    assert.equal(roomPersonPlan(["12", "14"], [people[0]], "Ada")[1].personId, "p1");
    assert.equal(roomPersonPlan(["12"], [], "Booking name")[0].personId, null);
  });

  it("does not create an account or overwrite a name when a code is resent", () => {
    const missing = resendAccessCode(null);
    assert.equal(missing.action, "ignore");
    assert.equal(missing.create_account, false);
    const known = resendAccessCode({ id: "g1", display_name: "Ada Lovelace" });
    assert.equal(known.action, "reissue");
    assert.equal(known.overwrite_name, false);
    assert.equal(known.create_account, false);
  });

  it("stops after the enquiry exists when the card page fails", () => {
    assert.equal(depositFollowUp(null), "stop");
    assert.equal(depositFollowUp({ id: "" }), "stop");
    assert.equal(depositFollowUp({ id: "enq" }), "checkout");
  });
});
