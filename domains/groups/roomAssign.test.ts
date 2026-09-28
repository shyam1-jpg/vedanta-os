import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EXPIRED, GENERIC_FAIL, nextFailedAttempts, publicLoginDetail } from "../guest/access.ts";
import {
  assignmentCsv,
  assignmentNote,
  autoAssign,
  cleanClientNote,
  conflicts,
  hashOrganiserCode,
  heldCapacity,
  holdChangeWarnings,
  listReady,
  lockedOn,
  newOrganiserCode,
  NOTE_MAX,
  offsetsDue,
  organiserClientView,
  organiserCodeCheck,
  parseRoomSettings,
  planAssignments,
  roomingCsv,
  roomingPdf,
  roomProgress,
  visibleGroups,
  withinClientLimit,
  type AutoClient,
  type AutoRoom,
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
    assert.deepEqual(parseRoomSettings({}), { cutoff_days: 7, staff_email: "", reminder_days: [14, 7, 2] });
    assert.equal(parseRoomSettings({ cutoff_days: 99, staff_email: " team@example.invalid " }).cutoff_days, 7);
    assert.equal(parseRoomSettings({ cutoff_days: 3, staff_email: " team@example.invalid " }).staff_email, "team@example.invalid");
    assert.deepEqual(parseRoomSettings({ reminder_days: [2, 2, 7, 0, 99] }).reminder_days, [7, 2]);
    const note = assignmentNote({ groupName: "Example Autumn Retreat", complete: true, who: "staff" });
    assert.match(note.subject, /completed/);
    const csv = assignmentCsv([{ room: "G03", date: "2026-10-13", group: "Example, Autumn", client: "Test Client 01" }]);
    assert.match(csv, /^room,date,group,client\n/);
    assert.match(csv, /"Example, Autumn"/);
  });
});

const autoRoom = (patch: Partial<AutoRoom> & Pick<AutoRoom, "id" | "number">): AutoRoom => ({
  capacity: 2,
  features: [],
  bedsSingle: 2,
  bedsDouble: 0,
  bedsKing: 0,
  section: "Ground Floor",
  ...patch,
});

const autoClient = (patch: Partial<AutoClient> & Pick<AutoClient, "personId" | "name">): AutoClient => ({
  preference: "twin",
  shareConsent: true,
  needsAccess: false,
  ...patch,
});

describe("client notes, readiness and the organiser view", () => {
  it("caps a note at 200 characters and the guest list at the held beds", () => {
    assert.equal(cleanClientNote("  ground floor please  ").ok && cleanClientNote("  ground floor please  ").note, "ground floor please");
    assert.equal(cleanClientNote("x".repeat(NOTE_MAX)).ok, true);
    assert.equal(cleanClientNote("x".repeat(NOTE_MAX + 1)).ok, false);
    assert.equal(heldCapacity([{ capacity: 2 }, { capacity: 1 }]), 3);
    assert.equal(withinClientLimit(3, [{ capacity: 2 }, { capacity: 1 }]), true);
    assert.equal(withinClientLimit(4, [{ capacity: 2 }, { capacity: 1 }]), false);
  });

  it("treats a share-with link as consent and refuses a split pair", () => {
    const a = client({ personId: "a", name: "Test Client 01", preference: "single", singleOccupancy: true, shareWithId: "b" });
    const b = client({ personId: "b", name: "Test Client 02", preference: "any", shareConsent: false });
    const together = plan({ clients: [a, b], placements: [{ personId: "a", roomId: "g03" }, { personId: "b", roomId: "g03" }] });
    assert.equal(together.ok, true);
    const split = plan({ clients: [a, b], placements: [{ personId: "a", roomId: "g03" }, { personId: "b", roomId: "g01" }] });
    assert.equal(split.ok, false);
    if (!split.ok) assert.match(split.error, /different rooms/);
    const stranger = plan({ clients: [client({ personId: "a", name: "Test Client 01", shareWithId: "missing" })], placements: [] });
    assert.equal(stranger.ok, false);
  });

  it("sends missed reminders together, then stops when the list is ready or the cut-off arrives", () => {
    const base = { arrival: "2026-10-12", cutoffDays: 7, offsets: [14, 7, 2], sent: [] as number[], ready: false };
    assert.deepEqual(offsetsDue({ ...base, today: "2026-09-20" }), []);
    assert.deepEqual(offsetsDue({ ...base, today: "2026-09-28" }), [14, 7]);
    assert.deepEqual(offsetsDue({ ...base, today: "2026-09-28", sent: [14] }), [7]);
    assert.deepEqual(offsetsDue({ ...base, today: "2026-09-28", ready: true }), []);
    assert.deepEqual(offsetsDue({ ...base, today: "2026-10-05" }), []);
    assert.equal(listReady({ unassigned: 0, missingDetails: 0, emptyBeds: 0 }), true);
    assert.equal(listReady({ unassigned: 0, missingDetails: 0, emptyBeds: 1 }), false);
    assert.deepEqual(roomProgress({ clients: 2, capacity: 4, detailsComplete: 1, assigned: 2 }), {
      clientsAdded: { done: 2, total: 4 },
      detailsComplete: { done: 1, total: 2 },
      assigned: { done: 2, total: 2 },
    });
  });

  it("warns before a hold drops someone or takes another group's room, and hides allergen fields", () => {
    const warnings = holdChangeWarnings({
      nextRoomIds: ["g01"],
      rooms: [{ id: "g03", number: "G03" }, { id: "g01", number: "G01" }],
      placed: [{ personId: "a", name: "Test Client 01", roomId: "g03" }],
      otherHolds: [{ roomId: "g01", groupName: "Example Spring Retreat" }],
    });
    assert.match(warnings.join(" "), /Test Client 01/);
    assert.match(warnings.join(" "), /Example Spring Retreat/);
    const view = organiserClientView({
      personId: "a", givenName: "Test", familyName: "Client 01", name: "Test Client 01", email: null,
      roomPreference: "single", shareConsent: false, arrivesEarly: false, note: "ground floor please",
      shareWithId: null, shareWithName: null, singleOccupancy: true, detailsComplete: true, roomId: null,
      isOrganiser: false, preferredRoomId: null,
    });
    assert.equal(view.details_complete, true);
    assert.equal(view.note, "ground floor please");
    assert.equal("allergens" in view, false);
    assert.equal("diet" in view, false);
    const csv = roomingCsv([{ room: "G03", client: "Test Client 01", note: "ground floor please", shareWith: "", single: "yes", details: "yes" }]);
    assert.match(csv, /^room,client,note,share with,single,details complete\n/);
    assert.equal(csv.toLowerCase().includes("allergen"), false);
    const pdf = roomingPdf("Example Autumn Retreat", [{ room: "G03", client: "Test Client 01", note: "arriving late", shareWith: "", single: "no", details: "yes" }]);
    assert.match(pdf, /^%PDF-1.4/);
    assert.equal(pdf.toLowerCase().includes("allergen"), false);
  });
});

describe("automatic room assignment", () => {
  const access = autoRoom({ id: "g03", number: "G03", features: ["disabled_access"], section: "Ground Floor" });
  const ground = autoRoom({ id: "g01", number: "G01", section: "Ground Floor" });
  const first = autoRoom({ id: "102", number: "102", section: "First Floor" });
  const alone = autoRoom({ id: "201", number: "201", capacity: 1, bedsSingle: 1, section: "First Floor" });

  const run = (patch: Partial<Parameters<typeof autoAssign>[0]>) => autoAssign({ rooms: [access, first], clients: [], kept: [], reassignAll: false, ...patch });

  it("puts step-free needs in an accessible room even when another room is emptier", () => {
    const result = run({
      clients: [autoClient({ personId: "a", name: "Test Client 01", needsAccess: true, shareConsent: false, preference: "any" })],
      kept: [{ personId: "b", roomId: "g03", source: "manual", locked: false }],
      rooms: [access, first],
    });
    // The kept person is not in the client list, so the accessible room is empty.
    const placed = run({
      clients: [
        autoClient({ personId: "b", name: "Test Client 02", shareConsent: true, preference: "twin" }),
        autoClient({ personId: "a", name: "Test Client 01", needsAccess: true, shareConsent: true, preference: "twin" }),
      ],
      kept: [{ personId: "b", roomId: "g03", source: "manual", locked: false }],
    });
    assert.equal(placed.placements.find(row => row.personId === "a")?.roomId, "g03");
    assert.equal(result.placements.find(row => row.personId === "a")?.roomId, "g03");
  });

  it("keeps a share-with pair together and sets a single request aside", () => {
    const result = run({
      rooms: [access, alone],
      clients: [
        autoClient({ personId: "a", name: "Test Client 01", shareWithId: "b", singleOccupancy: true, preference: "single", shareConsent: false }),
        autoClient({ personId: "b", name: "Test Client 02", preference: "any", shareConsent: false }),
      ],
    });
    const rooms = new Set(result.placements.map(row => row.roomId));
    assert.equal(rooms.size, 1);
    assert.equal(result.placements[0].roomId, "g03");
    assert.match(result.placements.map(row => row.reason).join(" "), /single-occupancy request was set aside/);
  });

  it("gives a single-occupancy request a room that nobody else joins", () => {
    const result = run({
      rooms: [ground, alone],
      clients: [
        autoClient({ personId: "a", name: "Test Client 01", singleOccupancy: true, preference: "single", shareConsent: false }),
        autoClient({ personId: "b", name: "Test Client 02" }),
      ],
    });
    assert.equal(result.placements.find(row => row.personId === "a")?.roomId, "201");
    assert.notEqual(result.placements.find(row => row.personId === "b")?.roomId, "201");
  });

  it("fills a twin with two people who agreed to share", () => {
    const result = run({
      rooms: [ground, alone],
      clients: [
        autoClient({ personId: "a", name: "Test Client 01" }),
        autoClient({ personId: "b", name: "Test Client 02" }),
      ],
    });
    assert.deepEqual(result.placements.map(row => row.roomId).sort(), ["g01", "g01"]);
  });

  it("clusters the next guest on the floor the group is already using", () => {
    const result = run({
      rooms: [
        autoRoom({ id: "g01", number: "G01", capacity: 1, bedsSingle: 1, section: "Ground Floor" }),
        autoRoom({ id: "g02", number: "G02", section: "Ground Floor" }),
        first,
      ],
      clients: [
        autoClient({ personId: "a", name: "Test Client 01", shareConsent: false, preference: "single" }),
        autoClient({ personId: "b", name: "Test Client 02" }),
      ],
      kept: [{ personId: "a", roomId: "g01", source: "manual", locked: false }],
    });
    assert.equal(result.placements.find(row => row.personId === "b")?.roomId, "g02");
  });

  it("uses the organiser's flagged room unless that would break access", () => {
    const flagged = run({
      rooms: [
        autoRoom({ id: "g01", number: "G01", capacity: 1, bedsSingle: 1, section: "Ground Floor" }),
        autoRoom({ id: "g02", number: "G02", section: "Ground Floor" }),
        first,
      ],
      clients: [
        autoClient({ personId: "a", name: "Test Client 01", shareConsent: false, preference: "single" }),
        autoClient({ personId: "b", name: "Test Client 02", isOrganiser: true, preferredRoomId: "102" }),
      ],
      kept: [{ personId: "a", roomId: "g01", source: "manual", locked: false }],
    });
    assert.equal(flagged.placements.find(row => row.personId === "b")?.roomId, "102");
    const accessFirst = run({
      rooms: [access, first],
      clients: [autoClient({ personId: "b", name: "Test Client 02", isOrganiser: true, preferredRoomId: "102", needsAccess: true, preference: "single", shareConsent: false })],
    });
    assert.equal(accessFirst.placements.find(row => row.personId === "b")?.roomId, "g03");
  });

  it("keeps a hand-set or locked room unless every assignment is being redone", () => {
    const rooms = [first, alone];
    const clients = [autoClient({ personId: "a", name: "Test Client 01", preference: "single", shareConsent: false, singleOccupancy: true })];
    const manual = run({ rooms, clients, kept: [{ personId: "a", roomId: "102", source: "manual", locked: false }] });
    assert.equal(manual.placements[0].roomId, "102");
    assert.equal(manual.placements[0].kept, true);
    const redone = run({ rooms, clients, kept: [{ personId: "a", roomId: "102", source: "manual", locked: false }], reassignAll: true });
    assert.equal(redone.placements[0].roomId, "201");
    const locked = run({ rooms, clients, kept: [{ personId: "a", roomId: "102", source: "auto", locked: true }] });
    assert.equal(locked.placements[0].roomId, "102");
    const unlocked = run({ rooms, clients, kept: [{ personId: "a", roomId: "102", source: "auto", locked: true }], reassignAll: true });
    assert.equal(unlocked.placements[0].roomId, "201");
  });

  it("never exceeds capacity and repeats the same result", () => {
    const input = {
      rooms: [autoRoom({ id: "g01", number: "G01", capacity: 2 })],
      clients: [
        autoClient({ personId: "c", name: "Test Client 03" }),
        autoClient({ personId: "a", name: "Test Client 01" }),
        autoClient({ personId: "b", name: "Test Client 02" }),
      ],
      kept: [],
      reassignAll: false,
    };
    const firstRun = autoAssign(input);
    const secondRun = autoAssign(input);
    assert.deepEqual(firstRun, secondRun);
    assert.equal(firstRun.placements.length, 2);
    assert.equal(firstRun.unassigned.length, 1);
    const perRoom = new Map<string, number>();
    for (const row of firstRun.placements) perRoom.set(row.roomId, (perRoom.get(row.roomId) ?? 0) + 1);
    assert.ok([...perRoom.values()].every(count => count <= 2));
  });
});
