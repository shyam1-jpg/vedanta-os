import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_HOUSE_RULES,
  applyPlan,
  createSwap,
  eligibleForBoard,
  filterSwaps,
  managerMustApprove,
  noticesFor,
  parseConstraintFile,
  parseHouseRules,
  parseSwapBoard,
  planAssignments,
  reviewTake,
  shouldExpire,
  transition,
  type PersonRule,
  type ShiftSlot,
} from "./shiftSwap.ts";

const house = DEFAULT_HOUSE_RULES;

function person(over: Partial<PersonRule> & Pick<PersonRule, "userId" | "roleCode">): PersonRule {
  return { earliestStart: null, unavailable: [], weeklyCap: null, monthlyCap: null, skills: [], cleared: true, ...over };
}

function shift(over: Partial<ShiftSlot> & Pick<ShiftSlot, "id" | "userId">): ShiftSlot {
  return { roleCode: "CHEF_DE_PARTIE", department: "KITCHEN", date: "2026-10-06", start: "09:00", end: "17:00", breakMinutes: 30, ...over };
}

const chef = person({ userId: "chef", roleCode: "CHEF_DE_PARTIE" });
const porter = person({ userId: "porter", roleCode: "KITCHEN_PORTER" });
const student = person({ userId: "student", roleCode: "KITCHEN_PORTER", weeklyCap: 16, monthlyCap: 40, earliestStart: "09:00" });

describe("shift swap flow", () => {
  const chefShift = shift({ id: "s-chef", userId: "chef", date: "2026-10-06", start: "09:00", end: "17:00" });
  const porterShift = shift({ id: "s-porter", userId: "porter", roleCode: "KITCHEN_PORTER", date: "2026-10-07", start: "09:00", end: "15:00" });
  const roster = [chefShift, porterShift];

  it("runs a named two-way swap through accept and approval, then moves both shifts together", () => {
    const opened = createSwap({ kind: "swap", requesterId: "chef", shiftId: "s-chef", partnerId: "porter", partnerShiftId: "s-porter", reason: "Family lunch", by: "chef" });
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    assert.equal(opened.request.status, "pending");
    const accepted = transition(opened.request, "accept", "porter");
    assert.equal(accepted.ok, true);
    if (!accepted.ok) return;
    const approved = transition(accepted.request, "approve", "manager", "Fine for the week");
    assert.equal(approved.ok, true);
    if (!approved.ok) return;
    assert.deepEqual(approved.request.history.map(row => row.status), ["pending", "accepted", "approved"]);
    const plan = planAssignments({
      kind: "swap", requester: chef, shift: chefShift, partner: porter, partnerShift: porterShift, claimer: null, roster, house,
    });
    assert.equal(plan.ok, false);
    if (plan.ok) return;
    assert.ok(plan.violations.some(item => item.code === "role_fit"));
    assert.equal(plan.assignments.length, 0);
    const swapped = applyPlan(roster, plan);
    assert.equal(swapped, null);
    assert.equal(roster[0].userId, "chef");
  });

  it("approves a cover between two chefs and leaves the original roster untouched until the whole plan applies", () => {
    const other = person({ userId: "other", roleCode: "CHEF_DE_PARTIE" });
    const otherShift = shift({ id: "s-other", userId: "other", date: "2026-10-08", start: "10:00", end: "16:00" });
    const mine = shift({ id: "s-chef", userId: "chef" });
    const rows = [mine, otherShift];
    const opened = createSwap({ kind: "cover", requesterId: "chef", shiftId: "s-chef", partnerId: "other", reason: "Appointment", by: "chef" });
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const accepted = transition(opened.request, "accept", "other");
    assert.equal(accepted.ok, true);
    if (!accepted.ok) return;
    const plan = planAssignments({ kind: "cover", requester: chef, shift: mine, partner: other, partnerShift: null, claimer: null, roster: rows, house });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.assignments.length, 1);
    const next = applyPlan(rows, plan);
    assert.ok(next);
    assert.equal(next?.find(row => row.id === "s-chef")?.userId, "other");
    assert.equal(rows[0].userId, "chef");
    const broken = applyPlan(rows, { ...plan, assignments: [...plan.assignments, { shiftId: "missing", fromUserId: "chef", toUserId: "other" }] });
    assert.equal(broken, null);
    assert.equal(rows[0].userId, "chef");
  });

  it("lets the requester cancel before approval and not after", () => {
    const opened = createSwap({ kind: "cover", requesterId: "chef", shiftId: "s-chef", partnerId: "porter", by: "chef" });
    if (!opened.ok) return;
    const cancelled = transition(opened.request, "cancel", "chef");
    assert.equal(cancelled.ok, true);
    if (!cancelled.ok) return;
    assert.equal(transition(cancelled.request, "approve", "manager").ok, false);
  });

  it("notifies the named partner, then everyone when it is approved", () => {
    const asked = noticesFor("created", { requesterId: "chef", partnerId: "porter", requesterName: "Example Chef", when: "Tue 6 Oct 09:00" });
    assert.equal(asked.length, 1);
    assert.equal(asked[0].toUserId, "porter");
    assert.match(asked[0].body, /Example Chef/);
    const done = noticesFor("approved", { requesterId: "chef", partnerId: "porter", claimerId: null, requesterName: "Example Chef", when: "Tue 6 Oct 09:00" });
    assert.deepEqual(done.map(note => note.toUserId).sort(), ["chef", "porter"]);
  });
});

describe("open board", () => {
  const kpShift = shift({ id: "s-kp", userId: "porter", roleCode: "KITCHEN_PORTER", start: "12:00", end: "20:00" });

  it("posts an open cover and lets an eligible porter claim it", () => {
    const opened = createSwap({ kind: "cover", requesterId: "porter", shiftId: "s-kp", by: "porter" });
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    assert.equal(opened.request.open, true);
    assert.equal(opened.request.status, "pending");
    const colleague = person({ userId: "porter-2", roleCode: "KITCHEN_PORTER" });
    assert.equal(eligibleForBoard(colleague, kpShift, [kpShift], house), true);
    assert.equal(eligibleForBoard(chef, kpShift, [kpShift, shift({ id: "s-chef", userId: "chef" })], house), false);
    const claimed = transition(opened.request, "claim", "porter-2");
    assert.equal(claimed.ok, true);
    if (!claimed.ok) return;
    assert.equal(claimed.request.status, "accepted");
    assert.equal(claimed.request.claimerId, "porter-2");
    const plan = planAssignments({
      kind: "cover", requester: porter, shift: kpShift, partner: null, partnerShift: null, claimer: colleague, roster: [kpShift], house,
    });
    assert.equal(plan.ok, true);
  });

  it("hides a chef shift from a kitchen porter", () => {
    const chefShift = shift({ id: "s-chef", userId: "chef" });
    assert.equal(eligibleForBoard(porter, chefShift, [chefShift], house), false);
  });
});

describe("rule violations", () => {
  it("blocks role mix, short rest, early starts, unavailable dates, and hour caps", () => {
    const kp = shift({ id: "kp", userId: "chef", roleCode: "KITCHEN_PORTER" });
    assert.equal(reviewTake(chef, kp, [kp], house).some(item => item.code === "role_fit" && item.severity === "hard"), true);
    const late = shift({ id: "late", userId: "chef", date: "2026-10-06", start: "14:00", end: "23:00" });
    const early = shift({ id: "early", userId: "chef", date: "2026-10-07", start: "07:00", end: "15:00" });
    assert.ok(reviewTake(chef, early, [late, early], house).some(item => item.code === "min_rest"));
    assert.ok(reviewTake(student, shift({ id: "dawn", userId: "student", start: "07:00", end: "12:00", roleCode: "KITCHEN_PORTER" }), [], house).some(item => item.code === "earliest_start"));
    const away = person({ userId: "chef", roleCode: "CHEF_DE_PARTIE", unavailable: ["2026-10-06"] });
    assert.ok(reviewTake(away, shift({ id: "day", userId: "chef" }), [], house).some(item => item.code === "unavailable"));
    const long = shift({ id: "long", userId: "student", roleCode: "KITCHEN_PORTER", start: "09:00", end: "18:00", breakMinutes: 0 });
    const already = shift({ id: "already", userId: "student", roleCode: "KITCHEN_PORTER", date: "2026-10-05", start: "09:00", end: "18:00", breakMinutes: 0 });
    assert.ok(reviewTake(student, long, [already, long], house).some(item => item.code === "weekly_cap"));
  });

  it("warns on the 40-hour week and on uncleared staff, and still returns a plan", () => {
    const busy = person({ userId: "chef", roleCode: "CHEF_DE_PARTIE", cleared: false });
    const held = [
      shift({ id: "a", userId: "chef", date: "2026-10-05", start: "08:00", end: "18:00", breakMinutes: 0 }),
      shift({ id: "b", userId: "chef", date: "2026-10-06", start: "08:00", end: "18:00", breakMinutes: 0 }),
      shift({ id: "c", userId: "chef", date: "2026-10-07", start: "08:00", end: "18:00", breakMinutes: 0 }),
      shift({ id: "d", userId: "chef", date: "2026-10-08", start: "08:00", end: "16:00", breakMinutes: 0 }),
    ];
    const extra = shift({ id: "e", userId: "other", date: "2026-10-09", start: "08:00", end: "16:00", breakMinutes: 0 });
    const issues = reviewTake(busy, { ...extra, userId: "chef" }, held.concat([{ ...extra, userId: "chef" }]), house);
    assert.ok(issues.some(item => item.code === "standard_week" && item.severity === "warn" && /Lieu/.test(item.message)));
    assert.ok(issues.some(item => item.code === "not_cleared" && item.severity === "warn"));
    const plan = planAssignments({
      kind: "cover",
      requester: person({ userId: "other", roleCode: "CHEF_DE_PARTIE" }),
      shift: extra,
      partner: null,
      partnerShift: null,
      claimer: busy,
      roster: held.concat([extra]),
      house,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.ok(plan.hours.some(row => row.userId === "chef" && row.lieuAfter > row.lieuBefore));
  });

  it("refuses a swap outright when only the second person breaks a rule", () => {
    const other = person({ userId: "other", roleCode: "CHEF_DE_PARTIE", earliestStart: "11:00" });
    const mine = shift({ id: "mine", userId: "chef", start: "09:00", end: "15:00" });
    const theirs = shift({ id: "theirs", userId: "other", date: "2026-10-08", start: "12:00", end: "18:00" });
    const plan = planAssignments({ kind: "swap", requester: chef, shift: mine, partner: other, partnerShift: theirs, claimer: null, roster: [mine, theirs], house });
    assert.equal(plan.ok, false);
    if (plan.ok) return;
    assert.equal(plan.assignments.length, 0);
    assert.equal(applyPlan([mine, theirs], plan), null);
  });
});

describe("expiry, filters, and the example constraint file", () => {
  it("expires at the shift start, or earlier when the house sets a lead time", () => {
    const slot = { date: "2026-10-06", start: "09:00" };
    const start = Date.parse("2026-10-06T09:00:00Z");
    assert.equal(shouldExpire(slot, 0, start - 1000), false);
    assert.equal(shouldExpire(slot, 0, start), true);
    assert.equal(shouldExpire(slot, 2, start - 2 * 3_600_000), true);
    const opened = createSwap({ kind: "day_off", requesterId: "chef", shiftId: "s", by: "chef" });
    if (!opened.ok) return;
    const expired = transition(opened.request, "expire", "system");
    assert.equal(expired.ok, true);
  });

  it("filters the history the admin list uses", () => {
    const items = [
      { status: "pending", kind: "swap" },
      { status: "approved", kind: "cover" },
      { status: "approved", kind: "swap" },
    ];
    assert.equal(filterSwaps(items, { status: "approved" }).length, 2);
    assert.equal(filterSwaps(items, { status: "approved", kind: "cover" }).length, 1);
  });

  it("reads only example addresses from a constraint file", () => {
    const rows = parseConstraintFile({
      people: [
        { email: "porter@example.invalid", earliest_start: "09:00", weekly_hours_cap: 20, unavailable: ["2026-12-25"], skills: ["KITCHEN_PORTER"] },
        { email: "real.person@thevedanta.org", weekly_hours_cap: 10 },
      ],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].weeklyCap, 20);
    assert.deepEqual(parseHouseRules({ min_rest_hours: 12, expire_hours_before: 4 }), {
      ...house, minRestHours: 12, expireHoursBefore: 4,
    });
  });

  it("lets a manager open a reassignment already waiting for their approval", () => {
    const opened = createSwap({ kind: "cover", requesterId: "chef", shiftId: "s-chef", partnerId: "other", by: "manager", manager: true });
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    assert.equal(opened.request.status, "accepted");
    assert.equal(transition(opened.request, "approve", "manager").ok, true);
  });

  it("keeps manager approval until the swap board is switched on", () => {
    const off = parseSwapBoard({});
    assert.equal(off.enabled, false);
    assert.equal(managerMustApprove(off, "Kitchen"), true);
    const on = parseSwapBoard({ board: true, approval: { Kitchen: true, front: false } });
    assert.equal(on.enabled, true);
    assert.equal(managerMustApprove(on, "kitchen"), true);
    assert.equal(managerMustApprove(on, "Front"), false);
    assert.equal(managerMustApprove(on, "Housekeeping"), false);
    const waiting = noticesFor("accepted", { requesterId: "chef", partnerId: "porter", managerId: "manager", requesterName: "Example Chef", when: "Tue 6 Oct 09:00" });
    assert.match(waiting.map(note => note.body).join(" "), /manager still has to approve/);
    const applied = noticesFor("claimed", { requesterId: "porter", claimerId: "porter-2", managerId: "manager", requesterName: "Example Porter", when: "Tue 6 Oct 12:00", settled: "applied" });
    assert.deepEqual(applied.map(note => note.toUserId).sort(), ["manager", "porter", "porter-2"]);
    assert.match(applied.map(note => note.body).join(" "), /rota was updated/);
    assert.equal(/still has to approve/.test(applied.map(note => note.body).join(" ")), false);
  });

  it("leaves a manager's open post on the board until somebody claims it", () => {
    const opened = createSwap({ kind: "cover", requesterId: "chef", shiftId: "s-chef", by: "manager", manager: true });
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    assert.equal(opened.request.open, true);
    assert.equal(opened.request.status, "pending");
    assert.equal(transition(opened.request, "claim", "porter").ok, true);
  });
});
