import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EXPIRED, GENERIC_FAIL, nextFailedAttempts, publicLoginDetail } from "../guest/access.ts";
import {
  assignmentCsv,
  assignmentNote,
  conflicts,
  hashOrganiserCode,
  lockedOn,
  newOrganiserCode,
  organiserCodeCheck,
  parseRoomSettings,
  planAssignments,
  visibleGroups,
  type RoomClient,
  type RoomHold,
} from "./roomAssign.ts";

const twin: RoomHold = { id: "g03", number: "G03", capacity: 2, features: ["disabled_access"], bedsSingle: 2, bedsDouble: 0, bedsKing: 0 };
const lake: RoomHold = { id: "g01", number: "G01", capacity: 2, features: ["lake_view"], bedsSingle: 2, bedsDouble: 0, bedsKing: 0 };
const single: RoomHold = { id: "s1", number: "201", capacity: 1, features: [], bedsSingle: 1, bedsDouble: 0, bedsKing: 0 };
const span = { arrival: "2026-10-12", departure: "2026-10-16" };

const client = (patch: Partial<RoomClient> & Pick<RoomClient, "personId" | "name">): RoomClient => ({
  preference: "twin",
  shareConsent: false,
  needsAccess: false,
  ...patch,
});

const plan = (patch: Partial<Parameters<typeof planAssignments>[0]>) => planAssignments({
  rooms: [twin, lake],
  clients: [],
  placements: [],
  span,
  locked: false,
  staff: false,
  ...patch,
});

describe("room assignment rules", () => {
  it("keeps a twin share inside capacity and reports the empty bed", () => {
    const a = client({ personId: "a", name: "Test Client 01", preference: "twin" });
    const result = plan({ clients: [a, client({ personId: "b", name: "Test Client 02" })], placements: [{ personId: "a", roomId: "g03" }] });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.unassigned.map(row => row.name), ["Test Client 02"]);
    assert.deepEqual(result.emptyBeds.find(row => row.number === "G03"), { roomId: "g03", number: "G03", empty: 1 });
  });

  it("rejects a second assignment, a full room, a single sharing, and a share without consent", () => {
    const a = client({ personId: "a", name: "Test Client 01", preference: "single" });
    const b = client({ personId: "b", name: "Test Client 02", preference: "any", shareConsent: false });
    assert.equal(plan({ clients: [a], placements: [{ personId: "a", roomId: "g03" }, { personId: "a", roomId: "g01" }] }).ok, false);
    assert.equal(plan({ rooms: [single], clients: [a, b], placements: [{ personId: "a", roomId: "s1" }, { personId: "b", roomId: "s1" }] }).error, "Room 201 sleeps 1.");
    const sharing = plan({ clients: [a, client({ personId: "b", name: "Test Client 02" })], placements: [{ personId: "a", roomId: "g03" }, { personId: "b", roomId: "g03" }] });
    assert.equal(sharing.ok, false);
    if (!sharing.ok) assert.equal(sharing.error, "A single room request cannot share.");
    const noConsent = plan({
      clients: [client({ personId: "a", name: "Test Client 01", preference: "any" }), b],
      placements: [{ personId: "a", roomId: "g01" }, { personId: "b", roomId: "g01" }],
    });
    assert.equal(noConsent.ok, false);
    if (!noConsent.ok) assert.equal(noConsent.error, "Sharing a room needs consent.");
  });

  it("accepts a twin or an explicit consent, and only warns on access", () => {
    const twinShare = plan({
      clients: [client({ personId: "a", name: "Test Client 01" }), client({ personId: "b", name: "Test Client 02", preference: "any", shareConsent: true })],
      placements: [{ personId: "a", roomId: "g03" }, { personId: "b", roomId: "g03" }],
    });
    assert.equal(twinShare.ok, true);
    const access = plan({
      clients: [client({ personId: "a", name: "Test Client 01", needsAccess: true })],
      placements: [{ personId: "a", roomId: "g01" }],
    });
    assert.equal(access.ok, true);
    if (access.ok) assert.match(access.warnings[0].message, /step-free access/);
    const suited = plan({
      clients: [client({ personId: "a", name: "Test Client 01", needsAccess: true })],
      placements: [{ personId: "a", roomId: "g03" }],
    });
    assert.equal(suited.ok, true);
    if (suited.ok) assert.equal(suited.warnings.length, 0);
  });

  it("rejects a twin preference in a room with one single bed, a stranger, another group's room, and dates outside the retreat", () => {
    const a = client({ personId: "a", name: "Test Client 01" });
    assert.equal(plan({ rooms: [single], clients: [a], placements: [{ personId: "a", roomId: "s1" }] }).error, "That room is not set up for a twin.");
    assert.equal(plan({ clients: [a], placements: [{ personId: "other", roomId: "g03" }] }).error, "That person is not on this retreat.");
    assert.equal(plan({ clients: [a], placements: [{ personId: "a", roomId: "elsewhere" }] }).error, "That room is not held for this retreat.");
    assert.equal(plan({ clients: [a], placements: [{ personId: "a", roomId: "g03", from: "2026-10-20", to: "2026-10-21" }] }).error, "Those dates are outside the retreat.");
  });

  it("locks the organiser on the cutoff morning and still lets staff override", () => {
    const a = client({ personId: "a", name: "Test Client 01" });
    assert.equal(lockedOn("2026-10-12", 7, "2026-10-04"), false);
    assert.equal(lockedOn("2026-10-12", 7, "2026-10-05"), true);
    const locked = plan({ locked: true, clients: [a], placements: [{ personId: "a", roomId: "g03" }] });
    assert.equal(locked.ok, false);
    if (!locked.ok) assert.match(locked.error, /locked room changes/);
    assert.equal(plan({ locked: true, staff: true, clients: [a], placements: [{ personId: "a", roomId: "g03" }] }).ok, true);
  });
});

describe("organiser scope and access codes", () => {
  it("drops every other group's rows", () => {
    const rows = visibleGroups(["own"], [{ groupId: "own", name: "Test Client 01" }, { groupId: "other", name: "Test Client 99" }]);
    assert.deepEqual(rows, [{ groupId: "own", name: "Test Client 01" }]);
  });

  it("flags two groups in the same room on the same half-day", () => {
    const found = conflicts([
      { roomId: "g03", date: "2026-10-13", slot: "PM", groupId: "a" },
      { roomId: "g03", date: "2026-10-13", slot: "PM", groupId: "b" },
      { roomId: "g01", date: "2026-10-13", slot: "AM", groupId: "a" },
    ]);
    assert.equal(found.length, 1);
    assert.deepEqual(found[0].groups.sort(), ["a", "b"]);
  });

  it("issues a long code and answers a revoked or expired code without saying revoked", () => {
    const code = newOrganiserCode();
    assert.ok(code.length >= 32);
    assert.match(code, /^[A-Za-z0-9_-]+$/);
    assert.notEqual(newOrganiserCode(), code);
    assert.match(hashOrganiserCode(code), /^[a-f0-9]{64}$/);
    const revoked = organiserCodeCheck({ found: true, revoked: true, hashMatches: true });
    assert.equal(publicLoginDetail(revoked), GENERIC_FAIL);
    assert.equal(GENERIC_FAIL.toLowerCase().includes("revoked"), false);
    const expired = organiserCodeCheck({ found: true, hashMatches: true, expiresAt: "2020-01-01T00:00:00Z" });
    assert.equal(publicLoginDetail(expired), EXPIRED);
    assert.equal(EXPIRED.toLowerCase().includes("revoked"), false);
    assert.equal(nextFailedAttempts(4).lockedUntil instanceof Date, true);
    assert.equal(nextFailedAttempts(3).lockedUntil, null);
  });

  it("defaults the cutoff to 7 days and writes a plain room list", () => {
    assert.deepEqual(parseRoomSettings({}), { cutoff_days: 7, staff_email: "" });
    assert.equal(parseRoomSettings({ cutoff_days: 99, staff_email: " team@example.invalid " }).cutoff_days, 7);
    assert.equal(parseRoomSettings({ cutoff_days: 3, staff_email: " team@example.invalid " }).staff_email, "team@example.invalid");
    const note = assignmentNote({ groupName: "Example Autumn Retreat", complete: true, who: "staff" });
    assert.match(note.subject, /completed/);
    const csv = assignmentCsv([{ room: "G03", date: "2026-10-13", group: "Example, Autumn", client: "Test Client 01" }]);
    assert.match(csv, /^room,date,group,client\n/);
    assert.match(csv, /"Example, Autumn"/);
  });
});
