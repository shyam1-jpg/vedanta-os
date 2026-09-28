import assert from "node:assert/strict";
import test from "node:test";
import {
  guestPickup,
  lateTrain,
  manifest,
  moveSeat,
  organiserShuttles,
  proposeRuns,
  seedShuttle,
  shuttleLetter,
  type TravelRequest,
} from "./transport.ts";

const service = seedShuttle();

function person(over: Partial<TravelRequest> = {}): TravelRequest {
  return {
    personKey: "p1",
    firstName: "Test Client",
    party: 1,
    groupId: "g1",
    groupName: "Example Autumn Retreat",
    direction: "arrival",
    mode: "shuttle",
    trainTime: "15:00",
    date: "2026-10-12",
    access: [],
    ...over,
  };
}

test("arrival times cluster inside 45 minutes and the vehicle, with no charge", () => {
  const proposed = proposeRuns({
    service,
    windowMinutes: 45,
    direction: "arrival",
    date: "2026-10-12",
    requests: [
      person({ personKey: "a", trainTime: "15:00", access: ["wheelchair"] }),
      person({ personKey: "b", firstName: "Other Example", trainTime: "15:20", party: 2, access: ["luggage"] }),
      person({ personKey: "c", trainTime: "16:30" }),
      person({ personKey: "d", mode: "own_car", trainTime: "15:10" }),
    ],
  });
  assert.equal(proposed.runs.length, 2);
  assert.equal(proposed.runs[0].pickupTime, "15:20");
  assert.equal(proposed.runs[0].meetingPoint, service.meetingPoint);
  assert.equal(proposed.runs[1].trainFrom, "16:30");
  assert.equal(proposed.skipped.length, 1);
  assert.match(manifest(proposed.runs[0])[0], /^Test · party 1 · wheelchair$/);
  assert.equal(manifest(proposed.runs[0]).some(line => /Client/.test(line)), false);
  assert.equal(JSON.stringify(proposed).includes("payment"), false);
  assert.equal(JSON.stringify(proposed).includes("£"), false);
  const full = proposeRuns({
    service: { ...service, capacity: 2 },
    windowMinutes: 45,
    direction: "arrival",
    date: "2026-10-12",
    requests: [
      person({ personKey: "a", party: 2, trainTime: "15:00" }),
      person({ personKey: "b", party: 2, trainTime: "15:10" }),
      person({ personKey: "c", party: 9, trainTime: "15:15" }),
    ],
  });
  assert.equal(full.runs.length, 3);
  assert.equal(full.runs[2].overflow, true);
});

test("departures leave the house in time, and a late train asks for a re-plan", () => {
  const proposed = proposeRuns({
    service,
    windowMinutes: 45,
    direction: "departure",
    date: "2026-10-16",
    requests: [
      person({ direction: "departure", date: "2026-10-16", trainTime: "16:00" }),
      person({ personKey: "b", direction: "departure", date: "2026-10-16", trainTime: "16:30", groupId: "g2", groupName: "Other" }),
    ],
  });
  assert.equal(proposed.runs.length, 1);
  assert.equal(proposed.runs[0].pickupTime, "15:35");
  assert.equal(proposed.runs[0].meetingPoint, "Front desk");
  const mine = organiserShuttles(proposed.runs, "g1");
  assert.equal(mine.length, 1);
  assert.equal(mine[0].name, "Test");
  assert.equal(organiserShuttles(proposed.runs, "g1").some(row => row.name === "Other"), false);
  const late = lateTrain(proposed.runs[0], "p1", "18:40", 45);
  assert.equal(late.fits, false);
  assert.match(late.suggestion, /Re-plan/);
  assert.match(late.suggestion, /18:40/);
  const still = lateTrain(proposed.runs[0], "p1", "16:20", 45);
  assert.equal(still.fits, true);
  assert.equal(guestPickup(proposed.runs, "p1")?.time, "15:35");
  assert.match(shuttleLetter(guestPickup(proposed.runs, "p1")), /15:35/);
  const moved = moveSeat(proposed.runs, "b", proposed.runs[0].id, 8);
  assert.equal(moved.ok, true);
});
