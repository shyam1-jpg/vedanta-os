import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assessDrop, mayApproveDepartment, mayDragShift, mayPublishDepartment, mayPublishRota, maySendMessage, shiftHours, suggestOpenShifts } from "./workforce.ts";

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

  it("counts one person's hours across both of their departments", () => {
    const placed = suggestOpenShifts(
      [
        { id: "k", department: "KITCHEN", date: "2026-10-19", hours: 8 },
        { id: "h", department: "HK", date: "2026-10-20", hours: 8 },
      ],
      [
        { id: "shreyas", department: "KITCHEN", hours: 40, unavailable: [] },
        { id: "shreyas", department: "HK", hours: 40, unavailable: [] },
      ],
    );
    assert.deepEqual(placed, [{ shiftId: "k", userId: "shreyas" }]);
  });

  it("refuses a drop over 48 hours and warns on availability and leave", () => {
    const blocked = assessDrop({
      shiftId: "open", hours: 8, toUserId: "shreyas", copy: false,
      weekShifts: [{ id: "a", userId: "shreyas", hours: 24 }, { id: "b", userId: "shreyas", hours: 21 }],
      unavailable: true, onLeave: false,
    });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.warnings[0].code, "hours");
    const warned = assessDrop({
      shiftId: "open", hours: 7.5, toUserId: "kitchen", copy: false,
      weekShifts: [{ id: "today", userId: "kitchen", hours: 7.5 }],
      unavailable: true, onLeave: true,
    });
    assert.equal(warned.allowed, true);
    assert.deepEqual(warned.warnings.map(w => w.code), ["availability", "leave"]);
    const copied = assessDrop({
      shiftId: "today", hours: 8, toUserId: "kitchen", copy: true,
      weekShifts: [{ id: "today", userId: "kitchen", hours: 42 }],
      unavailable: false, onLeave: false,
    });
    assert.equal(copied.allowed, false);
  });

  it("lets a head of department publish and drag only their rota", () => {
    assert.equal(mayPublishDepartment(["leave.approve_hod"], "KITCHEN", "KITCHEN"), true);
    assert.equal(mayPublishDepartment(["leave.approve_hod"], "KITCHEN", "HK"), false);
    assert.equal(mayPublishDepartment(["leave.approve_hod"], "KITCHEN", ""), false);
    assert.equal(mayPublishDepartment(["content.publish"], "MGMT", ""), true);
    assert.equal(mayDragShift(["leave.approve_hod"], "HK", "HK"), true);
    assert.equal(mayDragShift(["group.read"], "HK", "HK"), false);
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
