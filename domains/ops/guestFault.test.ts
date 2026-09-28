import assert from "node:assert/strict";
import test from "node:test";
import { followUpCopy, guestFaultDraft, guestStatus, screenGuestReport, urgentPing } from "./guestFault.ts";
import { reportNotices } from "./fault.ts";

const now = Date.parse("2026-10-12T10:00:00Z");

test("a leak is urgent, a tidy-up can wait, and a fridge copies the kitchen", () => {
  const leak = guestFaultDraft({ category: "water", urgency: "wait", description: "Water is leaking under the basin", room: "12", enter: true });
  assert.equal(leak.priority, "SAFETY");
  assert.equal(leak.department, "MAINTENANCE");
  assert.equal(leak.pingOnShift, true);
  const wait = guestFaultDraft({ category: "furniture", urgency: "wait", description: "A chair leg is loose", room: "12", enter: false });
  assert.equal(wait.priority, "NORMAL");
  assert.equal(wait.pingOnShift, false);
  assert.match(wait.description, /Staff may enter the room: no/);
  const clean = guestFaultDraft({ category: "cleanliness", urgency: "urgent", description: "The bathroom needs a clean", room: "12", enter: true });
  assert.equal(clean.department, "HOUSEKEEPING");
  assert.equal(clean.priority, "URGENT");
  const noise = guestFaultDraft({ category: "noise", urgency: "wait", description: "Music from the hall", room: "12", enter: false });
  assert.equal(noise.department, "FRONT");
  const cold = guestFaultDraft({ category: "other", urgency: "urgent", description: "The fridge in the room is warm", room: "12", enter: true });
  assert.equal(cold.foodSafety, true);
  const notes = reportNotices({
    number: 4, description: cold.description, location: "Room 12", equipment: cold.equipmentLabel, urgency: cold.priority, reporter: "Guest", foodSafety: true, photo: false,
  }, { maintenance: "desk@example.invalid", manager: "gm@example.invalid", kitchen: "kitchen@example.invalid" });
  assert.equal(notes.some(note => note.audience === "kitchen"), true);
  assert.equal(notes.some(note => note.audience === "manager"), true);
  const ping = urgentPing({ number: 4, description: leak.description, location: "Room 12", equipment: null, urgency: "SAFETY", reporter: "Guest", foodSafety: false, photo: false }, ["porter@example.invalid", "porter@example.invalid"]);
  assert.equal(ping.length, 1);
});

test("reports are limited, duplicates and links are refused, and the guest sees three words", () => {
  const recent = [{ at: now - 1000, text: "The tap will not stop" }];
  assert.equal(screenGuestReport({ description: "short", room: "12", category: "water", enter: true, recent: [], now }).ok, false);
  assert.equal(screenGuestReport({ description: "The tap will not stop", room: "", category: "water", enter: true, recent: [], now }).ok, false);
  assert.equal(screenGuestReport({ description: "The tap will not stop", room: "12", category: "water", enter: null, recent: [], now }).ok, false);
  assert.equal(screenGuestReport({ description: "See https://example.invalid/bad", room: "12", category: "water", enter: true, recent: [], now }).ok, false);
  assert.equal(screenGuestReport({ description: "The tap will not stop", room: "12", category: "water", enter: true, recent, now }).ok, false);
  const flood = Array.from({ length: 4 }, () => ({ at: now - 1000, text: "different words here now" }));
  assert.equal(screenGuestReport({ description: "Another real problem in the room", room: "12", category: "heating", enter: true, recent: flood, now }).ok, false);
  assert.equal(guestStatus("OPEN"), "received");
  assert.equal(guestStatus("ACKNOWLEDGED"), "received");
  assert.equal(guestStatus("IN_PROGRESS"), "on it");
  assert.equal(guestStatus("DONE"), "fixed");
  assert.match(followUpCopy(), /Was this sorted/);
});
