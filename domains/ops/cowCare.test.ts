import assert from "node:assert/strict";
import test from "node:test";
import {
  animalForSlot,
  guestCows,
  historyCsv,
  historyLines,
  isGuestFacing,
  mentionsHiddenAnimal,
  parseCowCareSettings,
  parseDay,
  parseVet,
  renameCow,
  seedCows,
  slotVisibleToGuest,
  todayBoard,
} from "./cowCare.ts";

const cows = seedCows();
const daisy = cows[0];
const bull = cows[1];

test("the log is off, and the bull is never guest facing", () => {
  assert.equal(parseCowCareSettings({}).enabled, false);
  assert.equal(parseCowCareSettings({ enabled: true }).enabled, true);
  assert.equal(daisy.guestFacing, true);
  assert.equal(bull.guestFacing, false);
  assert.equal(bull.kind, "bull");
  assert.equal(isGuestFacing(bull), false);
  assert.deepEqual(guestCows(cows).map(animal => animal.name), ["Example Daisy"]);
  assert.equal(mentionsHiddenAnimal("Supervised seva with Example Daisy", ["Example Bull"]), false);
  assert.equal(mentionsHiddenAnimal("A note about Example Bull", ["Example Bull"]), true);
});

test("the bull stays staff only after a rename, and a dairy note is refused", () => {
  const flipped = renameCow(bull, { name: "Example Storm", guest_facing: true });
  assert.equal(flipped.ok, false);
  const renamed = renameCow(bull, { name: "Example Storm", note: "STAFF ONLY." });
  assert.equal(renamed.ok, true);
  if (renamed.ok) {
    assert.equal(renamed.animal.guestFacing, false);
    assert.equal(renamed.animal.kind, "bull");
    assert.equal(mentionsHiddenAnimal("Caption of Example Storm in the field", [renamed.animal.name]), true);
  }
  assert.equal(renameCow(daisy, { name: "Example Daisy", note: "Morning milking" }).ok, false);
  assert.equal(parseDay({ animal_id: daisy.id, date: "2026-09-28", milk_yield: "4" }).ok, false);
});

test("a seva slot can link only to the guest-facing cow", () => {
  const blocked = animalForSlot("cow_care", cows, bull.id);
  assert.equal(blocked.ok, false);
  const linked = animalForSlot("cow_care", cows, null);
  assert.equal(linked.ok && linked.animalId, daisy.id);
  const other = animalForSlot("gardening", cows, daisy.id);
  assert.equal(other.ok, false);
  assert.equal(slotVisibleToGuest(bull.id, cows), false);
  assert.equal(slotVisibleToGuest(daisy.id, cows), true);
  assert.equal(slotVisibleToGuest(null, cows), true);
});

test("today shows the duty and the feed that are still missing", () => {
  const day = parseDay({ animal_id: daisy.id, date: "2026-09-28", duty: "Example Keeper" });
  assert.equal(day.ok, true);
  if (!day.ok) return;
  const visit = parseVet({ animal_id: bull.id, date: "2026-09-01", vet: "Example Vet", reason: "Check", outcome: "Example outcome", follow_up: "2026-09-28" });
  assert.equal(visit.ok, true);
  if (!visit.ok) return;
  const board = todayBoard({ animals: cows, days: [day.log], visits: [visit.visit], date: "2026-09-28" });
  const gentle = board.find(card => card.animalId === daisy.id)!;
  assert.deepEqual(gentle.missing, ["Feeding"]);
  assert.match(gentle.done[0], /Example Keeper/);
  const staff = board.find(card => card.animalId === bull.id)!;
  assert.deepEqual(staff.missing, ["Who is with them", "Feeding"]);
  assert.equal(staff.guestFacing, false);
  assert.equal(staff.followUp, "Follow-up due");
  assert.equal(parseVet({ animal_id: bull.id, date: "2026-09-02", vet: "Example Vet", reason: "Dairy check" }).ok, false);
});

test("the export lists care notes and has no dairy column", () => {
  const lines = historyLines(cows, [{
    animalId: daisy.id, date: "2026-09-27", duty: "Example Keeper", feedWhat: "Hay", feedWhen: "07:30", feedAmount: "2 kg", health: "Calm",
  }], [{
    animalId: bull.id, date: "2026-09-01", vet: "Example Vet", reason: "Check", outcome: "Example outcome", followUp: "2026-12-01",
  }]);
  const csv = historyCsv(lines);
  assert.match(csv, /^date,animal,guest_facing,duty,feed_what,feed_when,feed_amount,health,vet,reason,outcome,follow_up/);
  assert.match(csv, /Example Daisy/);
  assert.match(csv, /Example Bull,no/);
  assert.equal(/\b(milk|milking|dairy)\b/i.test(csv), false);
});
