import assert from "node:assert/strict";
import test from "node:test";
import {
  bookSeva,
  cancelSeva,
  generateDailySlots,
  guestAnimals,
  kitchenTasks,
  parseSevaSafety,
  seedActivities,
  seedAnimals,
  sevaBriefingText,
  slotBookable,
  welcomeSevaLines,
  type SevaBooking,
  type SevaSlot,
} from "./seva.ts";
import { buildBriefing, DEFAULT_RULES, type BriefingFacts } from "./briefing.ts";

const safety = parseSevaSafety({});
const activities = seedActivities();
const animals = seedAnimals();
const kitchen = activities.find(item => item.kind === "kitchen_help")!;
const cows = activities.find(item => item.kind === "cow_care")!;

function slot(over: Partial<SevaSlot> = {}): SevaSlot {
  return {
    id: "cow-care:2026-10-12:10:00",
    activityId: cows.id,
    date: "2026-10-12",
    start: "10:00",
    end: "10:45",
    capacity: 1,
    supervisorName: "Example Keeper",
    ...over,
  };
}

test("placeholder animals keep the bull off the guest list", () => {
  assert.equal(animals.some(animal => animal.name === "Example Daisy" && animal.audience === "guest"), true);
  assert.equal(animals.some(animal => animal.name === "Example Bull" && animal.audience === "staff"), true);
  assert.deepEqual(guestAnimals(animals).map(animal => animal.name), ["Example Daisy"]);
  assert.equal(safety.guestsVisitCowsWithStaff, true);
  assert.equal(safety.kitchenFoodHandling, false);
  assert.deepEqual(kitchenTasks(kitchen, safety), ["Washing up", "Laying the buffet"]);
});

test("daily slots are one a day and a missing supervisor cannot be booked", () => {
  const slots = generateDailySlots({
    activityId: kitchen.id,
    from: "2026-10-12",
    to: "2026-10-14",
    start: "09:00",
    durationMinutes: 90,
    capacity: 4,
  });
  assert.equal(slots.length, 3);
  assert.equal(slots[2].date, "2026-10-14");
  assert.equal(slots[0].end, "10:30");
  assert.equal(slotBookable(null).ok, false);
  assert.match(sevaBriefingText(cows, slot({ supervisorName: null }), []), /unsupervised: not bookable/);
});

test("capacity, overlap, age, waiver, hygiene, and staff-only animals", () => {
  const cow = slot();
  const blocked = bookSeva({
    personKey: "p1", firstName: "Test", age: 20, slot: { ...cow, supervisorName: null }, activity: cows, animals, chosenAnimalId: "example-daisy",
    existing: [], waiverAck: true, hygieneAck: false, safety,
  });
  assert.equal(blocked.ok, false);

  const young = bookSeva({
    personKey: "p1", firstName: "Test", age: 12, slot: cow, activity: cows, animals, chosenAnimalId: "example-daisy",
    existing: [], waiverAck: true, hygieneAck: false, safety,
  });
  assert.equal(young.ok, false);

  const noWaiver = bookSeva({
    personKey: "p1", firstName: "Test", age: 20, slot: cow, activity: cows, animals, chosenAnimalId: "example-daisy",
    existing: [], waiverAck: false, hygieneAck: false, safety,
  });
  assert.equal(noWaiver.ok, false);

  const bull = bookSeva({
    personKey: "p1", firstName: "Test", age: 20, slot: cow, activity: cows, animals, chosenAnimalId: "example-bull",
    existing: [], waiverAck: true, hygieneAck: false, safety,
  });
  assert.equal(bull.ok, false);
  if (!bull.ok) assert.match(bull.error, /staff only/);

  const linkedBull = bookSeva({
    personKey: "p1", firstName: "Test", age: 20, slot: { ...cow, animalId: "example-bull" }, activity: cows, animals, chosenAnimalId: "example-daisy",
    existing: [], waiverAck: true, hygieneAck: false, safety,
  });
  assert.equal(linkedBull.ok, false);

  const first = bookSeva({
    personKey: "p1", firstName: "Test", age: 20, slot: cow, activity: cows, animals, chosenAnimalId: "example-daisy",
    existing: [], waiverAck: true, hygieneAck: false, safety,
  });
  assert.equal(first.ok && first.status, "booked");
  const again = bookSeva({
    personKey: "p1", firstName: "Test", age: 20, slot: cow, activity: cows, animals, chosenAnimalId: "example-daisy",
    existing: [{ personKey: "p1", slotId: cow.id, firstName: "Test", status: "booked", date: cow.date, start: cow.start, end: cow.end, animalId: "example-daisy" }],
    waiverAck: true, hygieneAck: false, safety,
  });
  assert.equal(again.ok && again.status, "booked");

  const waiting = bookSeva({
    personKey: "p2", firstName: "Other", age: 21, slot: cow, activity: cows, animals, chosenAnimalId: "example-daisy",
    existing: [{ personKey: "p1", slotId: cow.id, firstName: "Test", status: "booked", date: cow.date, start: cow.start, end: cow.end, animalId: "example-daisy" }],
    waiverAck: true, hygieneAck: false, safety,
  });
  assert.equal(waiting.ok && waiting.status, "waitlist");

  const clash = bookSeva({
    personKey: "p1", firstName: "Test", age: 20,
    slot: slot({ id: "gardening:2026-10-12:10:15", activityId: "gardening", start: "10:15", end: "11:00", capacity: 4 }),
    activity: activities.find(item => item.kind === "gardening")!,
    animals, chosenAnimalId: null,
    existing: [{ personKey: "p1", slotId: cow.id, firstName: "Test", status: "booked", date: cow.date, start: cow.start, end: cow.end, animalId: null }],
    waiverAck: true, hygieneAck: true, safety,
  });
  assert.equal(clash.ok, false);

  const wash = slot({ id: "kitchen-help:2026-10-12:09:00", activityId: kitchen.id, start: "09:00", end: "10:30", capacity: 4, supervisorName: "Example Cook" });
  const noBrief = bookSeva({
    personKey: "p3", firstName: "Test", age: 30, slot: wash, activity: kitchen, animals, chosenAnimalId: null,
    existing: [], waiverAck: true, hygieneAck: false, safety,
  });
  assert.equal(noBrief.ok, false);
  const food = bookSeva({
    personKey: "p3", firstName: "Test", age: 30, slot: wash, activity: { ...kitchen, tasks: ["Cooking"] }, animals, chosenAnimalId: null,
    existing: [], waiverAck: true, hygieneAck: true, safety,
  });
  assert.equal(food.ok, false);
});

test("cancelling a place offers it to the first person waiting", () => {
  const cow = slot();
  const existing: SevaBooking[] = [
    { personKey: "p1", slotId: cow.id, firstName: "Test", status: "booked", date: cow.date, start: cow.start, end: cow.end, animalId: "example-daisy" },
    { personKey: "p2", slotId: cow.id, firstName: "Other", status: "waitlist", date: cow.date, start: cow.start, end: cow.end, animalId: "example-daisy" },
  ];
  const next = cancelSeva(existing, "p1", cow.id);
  assert.equal(next.promoted, "p2");
  assert.equal(next.bookings.find(row => row.personKey === "p2")?.status, "booked");
  assert.equal(welcomeSevaLines(activities, [cow], next.bookings, "p2")[0].includes("Cow care"), true);
});

test("the morning briefing lists seva only when the house has passed the day's slots", () => {
  const facts: BriefingFacts = {
    date: "2026-10-12",
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
    seva: [{ id: "cow", text: sevaBriefingText(cows, slot({ supervisorName: null }), []) }],
  };
  const board = buildBriefing({ facts, view: "house", rules: DEFAULT_RULES, marks: [], userId: "staff" });
  const section = board.sections.find(item => item.key === "seva");
  assert.ok(section);
  assert.match(section.lines[0].text, /unsupervised: not bookable/);
  const plain = buildBriefing({ facts: { ...facts, seva: undefined }, view: "house", rules: DEFAULT_RULES, marks: [], userId: "staff" });
  assert.equal(plain.sections.some(item => item.key === "seva"), false);
});
