import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HARI_REMINDER, breaksDiet, buyNeedsApproval, canHoldDate, canReadJournal, carbonTotal,
  firstAidNext, gapDays, herdSeed, isOnionFamilyCrop, laterIsLower, loyaltyBalance,
  moneyOutOnce, nextDueFrom, nightFill, photoForDay, rateNudge, renewalDue,
} from "./rules.ts";

describe("house rules", () => {
  it("blocks diet-breaking dishes and keeps onion crops off a guest menu", () => {
    assert.equal(breaksDiet("leek soup"), "leek");
    assert.equal(breaksDiet("garden dal"), null);
    assert.equal(isOnionFamilyCrop("spring onion"), true);
    assert.equal(isOnionFamilyCrop("chard"), false);
  });
  it("blocks a date only when capacity is actually used", () => {
    assert.equal(nightFill(10, [{ exclusive: false, rooms: 4 }]), "part");
    assert.equal(nightFill(10, [{ exclusive: true, rooms: 1 }]), "blocked");
    assert.equal(nightFill(0, []), "unknown");
    assert.equal(canHoldDate(10, [{ exclusive: false, rooms: 8 }], { exclusive: false, rooms: 3 }), false);
    assert.equal(canHoldDate(10, [{ exclusive: false, rooms: 4 }], { exclusive: false, rooms: 3 }), true);
  });
  it("shows a photo of the day only when staff picked one for that day", () => {
    assert.equal(photoForDay([{ on: "2026-10-10", photoId: "p1" }], "2026-10-10"), "p1");
    assert.equal(photoForDay([{ on: "2026-10-10", photoId: "p1" }], "2026-10-11"), null);
  });
  it("keeps a journal private until the guest shares it", () => {
    const entry = { ownerId: "g", shareStaff: false, shareGuests: false, bookingId: "b" };
    assert.equal(canReadJournal(entry, { kind: "guest", id: "g", bookingId: "b" }), true);
    assert.equal(canReadJournal(entry, { kind: "staff", bookingId: "b" }), false);
    assert.equal(canReadJournal({ ...entry, shareStaff: true }, { kind: "staff", bookingId: "b" }), true);
    assert.equal(canReadJournal({ ...entry, shareGuests: true }, { kind: "guest", id: "other", bookingId: "b" }), true);
    assert.equal(canReadJournal({ ...entry, shareStaff: true }, { kind: "staff", bookingId: "other" }), false);
  });
  it("does not invent a carbon total, a rate, points, or a due date", () => {
    assert.equal(carbonTotal([{ amount: 10, factor: null }]).total, null);
    assert.equal(carbonTotal([{ amount: 10, factor: 0.2 }]).total, 2);
    assert.equal(laterIsLower(null, 1), false);
    assert.equal(laterIsLower(5, 4), true);
    assert.equal(rateNudge({ occupancyPct: 90, threshold: 80, currentRate: null, nudge: 10 }).suggest, null);
    assert.equal(rateNudge({ occupancyPct: 90, threshold: 80, currentRate: 100, nudge: 15 }).suggest, 115);
    assert.equal(loyaltyBalance([]), null);
    assert.equal(nextDueFrom(null, 6), null);
    assert.equal(nextDueFrom("2026-01-15", 6), "2026-07-15");
    assert.equal(firstAidNext(null), null);
    assert.equal(firstAidNext("2026-10-01"), "2026-10-08");
    assert.equal(buyNeedsApproval(40, null), false);
    assert.equal(buyNeedsApproval(40, 25), true);
    assert.equal(moneyOutOnce({ supplier: 10, labour: 5, pettySpent: 2, placedOrders: 3 }), 20);
  });
  it("names Hari as male and Lakshmi as female, and only those two", () => {
    assert.deepEqual(herdSeed(), [
      { name: "Hari", sex: "male", kind: "bull" },
      { name: "Lakshmi", sex: "female", kind: "cow" },
    ]);
    assert.match(HARI_REMINDER, /never go near Hari/);
    assert.equal(renewalDue("2026-10-20", "2026-10-01"), true);
    assert.deepEqual(gapDays("2026-10-12", "2026-10-15"), ["2026-10-12", "2026-10-13", "2026-10-14"]);
  });
});
