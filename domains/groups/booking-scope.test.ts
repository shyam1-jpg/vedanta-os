import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bookingMatchesScope,
  bookingScopeFilterSql,
  bookingScopeOrderSql,
  londonToday,
  parseBookingListScope,
  sortBookings,
} from "./booking-scope.ts";
import { bookingMatchesScope as clientMatch, londonToday as clientToday, sortBookings as clientSort } from "../../apps/web-admin/lib/booking-scope.ts";

const today = "2026-09-28";

describe("booking list scope", () => {
  it("uses the Europe/London calendar date, including across midnight UTC", () => {
    assert.equal(londonToday(new Date("2026-09-28T22:30:00Z")), "2026-09-28");
    assert.equal(londonToday(new Date("2026-09-28T23:30:00Z")), "2026-09-29");
    assert.equal(londonToday(new Date("2026-01-15T23:30:00Z")), "2026-01-15");
  });

  it("defaults an omitted scope to the full list for other callers", () => {
    assert.equal(parseBookingListScope(undefined), "omit");
    assert.equal(parseBookingListScope(""), "omit");
    assert.equal(parseBookingListScope("upcoming"), "upcoming");
    assert.equal(parseBookingListScope(" PAST "), "past");
    assert.equal(parseBookingListScope("nope"), "invalid");
    assert.equal(bookingScopeFilterSql("omit"), "true");
    assert.equal(bookingScopeFilterSql("all"), "true");
  });

  it("keeps current and upcoming bookings, and parks cancelled ones with the past", () => {
    const rows = [
      { name: "ends today", departure: "2026-09-28", status: "IN_HOUSE" },
      { name: "ahead", departure: "2026-10-09", status: "CONFIRMED" },
      { name: "ended", departure: "2026-03-06", status: "COMPLETED" },
      { name: "cancelled ahead", departure: "2026-12-04", status: "CANCELLED" },
      { name: "completed but not yet ended", departure: "2026-09-30", status: "COMPLETED" },
    ];
    const upcoming = rows.filter(g => bookingMatchesScope(g, "upcoming", today)).map(g => g.name);
    const past = rows.filter(g => bookingMatchesScope(g, "past", today)).map(g => g.name);
    const all = rows.filter(g => bookingMatchesScope(g, "all", today)).map(g => g.name);
    assert.deepEqual(upcoming, ["ends today", "ahead", "completed but not yet ended"]);
    assert.deepEqual(past, ["ended", "cancelled ahead"]);
    assert.equal(all.length, rows.length);
    assert.match(bookingScopeFilterSql("upcoming"), /status <> 'CANCELLED'/);
    assert.match(bookingScopeFilterSql("past"), /status = 'CANCELLED'/);
    assert.doesNotMatch(bookingScopeFilterSql("upcoming"), /delete/i);
  });

  it("sorts the past list with the most recent departure first", () => {
    const sorted = sortBookings([
      { arrival: "2026-01-01", departure: "2026-01-04", status: "COMPLETED" },
      { arrival: "2026-12-01", departure: "2026-12-04", status: "CANCELLED" },
      { arrival: "2026-06-01", departure: "2026-06-04", status: "COMPLETED" },
    ], "past");
    assert.deepEqual(sorted.map(g => g.departure), ["2026-12-04", "2026-06-04", "2026-01-04"]);
    assert.match(bookingScopeOrderSql("past"), /departure_date desc/);
    assert.match(bookingScopeOrderSql("upcoming"), /^arrival_date/);
  });

  it("matches the bookings screen helpers", () => {
    const now = new Date("2026-09-28T23:30:00Z");
    assert.equal(clientToday(now), londonToday(now));
    const rows = [
      { arrival: "2026-03-01", departure: "2026-03-06", status: "COMPLETED" },
      { arrival: "2026-12-01", departure: "2026-12-04", status: "CANCELLED" },
      { arrival: "2026-09-28", departure: "2026-09-28", status: "IN_HOUSE" },
    ];
    for (const scope of ["upcoming", "past", "all"] as const) {
      assert.deepEqual(
        rows.filter(g => clientMatch(g, scope, today)).map(g => g.status),
        rows.filter(g => bookingMatchesScope(g, scope, today)).map(g => g.status),
      );
      assert.deepEqual(clientSort(rows, scope), sortBookings(rows, scope));
    }
  });
});
