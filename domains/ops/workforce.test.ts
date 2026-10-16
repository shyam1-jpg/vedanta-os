import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mayApproveDepartment, mayPublishRota, maySendMessage, shiftHours, suggestOpenShifts } from "./workforce.ts";

describe("workforce schedule", () => {
  it("counts a shift minus the break, including overnight", () => {
    assert.equal(shiftHours("09:00", "17:00", 30), 7.5);
    assert.equal(shiftHours("22:00", "06:00", 30), 7.5);
  });

  it("will not auto-schedule anyone past 48 hours", () => {
    const placed = suggestOpenShifts(
      [
        { id: "a", department: "KITCHEN", date: "2026-10-19", hours: 8 },
        { id: "b", department: "KITCHEN", date: "2026-10-20", hours: 8 },
      ],
      [
        { id: "busy", department: "KITCHEN", hours: 42, unavailable: [] },
        { id: "free", department: "KITCHEN", hours: 10, unavailable: ["2026-10-20"] },
        { id: "other", department: "HK", hours: 0, unavailable: [] },
      ],
    );
    assert.deepEqual(placed, [{ shiftId: "a", userId: "free" }]);
  });

  it("keeps rota publishing and broadcasts with the owner and general manager", () => {
    assert.equal(mayPublishRota(["leave.approve_hod"]), false);
    assert.equal(mayPublishRota(["content.publish"]), true);
    assert.equal(mayApproveDepartment(["leave.approve_hod"], "KITCHEN", "KITCHEN"), true);
    assert.equal(mayApproveDepartment(["leave.approve_hod"], "KITCHEN", "HK"), false);
    assert.equal(mayApproveDepartment(["content.publish"], null, "HK"), true);
    assert.equal(maySendMessage(["group.read"], { broadcast: true, reply: false, targetsAreManagers: false }), false);
    assert.equal(maySendMessage(["group.read"], { broadcast: false, reply: false, targetsAreManagers: true }), true);
    assert.equal(maySendMessage(["group.read"], { broadcast: false, reply: true, targetsAreManagers: false }), true);
  });
});
