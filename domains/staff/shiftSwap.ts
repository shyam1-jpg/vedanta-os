/** Shift swaps. Rules are data. This file has no real people. */

export const SWAP_KINDS = ["swap", "cover", "day_off"] as const;
export const SWAP_STATUSES = ["pending", "accepted", "declined", "approved", "rejected", "cancelled", "expired"] as const;
export type SwapKind = (typeof SWAP_KINDS)[number];
export type SwapStatus = (typeof SWAP_STATUSES)[number];
export type Severity = "hard" | "warn";

export type ShiftSlot = {
  id: string;
  userId: string;
  roleCode: string | null;
  department: string;
  date: string;
  start: string;
  end: string;
  breakMinutes: number;
};

export type PersonRule = {
  userId: string;
  roleCode: string;
  earliestStart: string | null;
  unavailable: string[];
  weeklyCap: number | null;
  monthlyCap: number | null;
  skills: string[];
  cleared: boolean;
};

export type HouseRules = {
  minRestHours: number;
  standardWeekHours: number;
  expireHoursBefore: number;
  chefRoles: string[];
  kpRoles: string[];
};

export type Violation = { code: string; severity: Severity; message: string };

export type HoursEffect = {
  userId: string;
  weekStart: string;
  weeklyBefore: number;
  weeklyAfter: number;
  lieuBefore: number;
  lieuAfter: number;
  monthlyBefore: number;
  monthlyAfter: number;
};

export type Assignment = { shiftId: string; fromUserId: string; toUserId: string };

export type SwapPlan =
  | { ok: true; assignments: Assignment[]; warnings: Violation[]; hours: HoursEffect[] }
  | { ok: false; violations: Violation[]; assignments: [] };

export const DEFAULT_HOUSE_RULES: HouseRules = {
  minRestHours: 11,
  standardWeekHours: 40,
  expireHoursBefore: 0,
  chefRoles: ["HEAD_CHEF", "KITCHEN_MANAGER", "SOUS_CHEF", "SENIOR_CHEF_DE_PARTIE", "CHEF_DE_PARTIE"],
  kpRoles: ["KITCHEN_PORTER"],
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseHouseRules(raw: unknown): HouseRules {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const rest = Number(src.min_rest_hours ?? src.minRestHours);
  const week = Number(src.standard_week_hours ?? src.standardWeekHours);
  const expire = Number(src.expire_hours_before ?? src.expireHoursBefore);
  const chefs = Array.isArray(src.chef_roles) ? src.chef_roles.map(v => String(v).trim()).filter(Boolean) : DEFAULT_HOUSE_RULES.chefRoles;
  const kps = Array.isArray(src.kp_roles) ? src.kp_roles.map(v => String(v).trim()).filter(Boolean) : DEFAULT_HOUSE_RULES.kpRoles;
  return {
    minRestHours: Number.isFinite(rest) && rest >= 0 && rest <= 24 ? rest : DEFAULT_HOUSE_RULES.minRestHours,
    standardWeekHours: Number.isFinite(week) && week > 0 && week <= 80 ? week : DEFAULT_HOUSE_RULES.standardWeekHours,
    expireHoursBefore: Number.isFinite(expire) && expire >= 0 && expire <= 168 ? Math.round(expire) : 0,
    chefRoles: chefs.length ? chefs : DEFAULT_HOUSE_RULES.chefRoles,
    kpRoles: kps.length ? kps : DEFAULT_HOUSE_RULES.kpRoles,
  };
}

export type ConstraintRow = {
  email: string;
  earliestStart: string | null;
  weeklyCap: number | null;
  monthlyCap: number | null;
  unavailable: string[];
  skills: string[];
};

/** House-specific rows belong in a gitignored file. This parser only accepts the shape. */
export function parseConstraintFile(raw: unknown): ConstraintRow[] {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const people = Array.isArray(src.people) ? src.people : [];
  const rows: ConstraintRow[] = [];
  for (const item of people) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const email = String(row.email ?? "").trim().toLowerCase();
    if (!email.endsWith(".invalid") && !email.endsWith("@example.com")) continue;
    const earliest = String(row.earliest_start ?? "").trim();
    const weekly = Number(row.weekly_hours_cap);
    const monthly = Number(row.monthly_hours_cap);
    rows.push({
      email,
      earliestStart: TIME.test(earliest) ? earliest : null,
      weeklyCap: Number.isFinite(weekly) && weekly > 0 ? weekly : null,
      monthlyCap: Number.isFinite(monthly) && monthly > 0 ? monthly : null,
      unavailable: Array.isArray(row.unavailable) ? row.unavailable.map(v => String(v)).filter(v => DATE.test(v)) : [],
      skills: Array.isArray(row.skills) ? row.skills.map(v => String(v).trim()).filter(Boolean) : [],
    });
  }
  return rows;
}

function clock(value: string): string {
  return value.slice(0, 5);
}

export function shiftBounds(slot: Pick<ShiftSlot, "date" | "start" | "end">): { startMs: number; endMs: number } {
  const startMs = Date.parse(`${slot.date}T${clock(slot.start)}:00Z`);
  let endMs = Date.parse(`${slot.date}T${clock(slot.end)}:00Z`);
  if (endMs <= startMs) endMs += 86_400_000;
  return { startMs, endMs };
}

export function paidHours(slot: Pick<ShiftSlot, "date" | "start" | "end" | "breakMinutes">): number {
  const { startMs, endMs } = shiftBounds(slot);
  const hours = (endMs - startMs) / 3_600_000 - (Number(slot.breakMinutes) || 0) / 60;
  return Math.max(0, Math.round(hours * 100) / 100);
}

export function weekStartMonday(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const utc = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() - (day - 1));
  return utc.toISOString().slice(0, 10);
}

export function lieuHours(weekly: number, standard: number): number {
  return Math.max(0, Math.round((weekly - standard) * 100) / 100);
}

function sumHours(slots: ShiftSlot[], pred: (slot: ShiftSlot) => boolean): number {
  const total = slots.filter(pred).reduce((n, slot) => n + paidHours(slot), 0);
  return Math.round(total * 100) / 100;
}

export function restGapHours(a: ShiftSlot, b: ShiftSlot): number {
  const A = shiftBounds(a);
  const B = shiftBounds(b);
  if (A.startMs < B.endMs && B.startMs < A.endMs) return 0;
  const gap = A.endMs <= B.startMs ? B.startMs - A.endMs : A.startMs - B.endMs;
  return Math.round((gap / 3_600_000) * 100) / 100;
}

export function roleFit(person: PersonRule, shiftRole: string | null, house: HouseRules): Violation | null {
  if (person.skills.length && shiftRole && (person.skills.includes(shiftRole) || shiftRole === person.roleCode)) return null;
  if (!shiftRole) return null;
  const chef = house.chefRoles.includes(person.roleCode);
  const kp = house.kpRoles.includes(person.roleCode);
  if (chef && house.kpRoles.includes(shiftRole)) {
    return { code: "role_fit", severity: "hard", message: "A chef is not assigned a kitchen porter shift." };
  }
  if (kp && house.chefRoles.includes(shiftRole)) {
    return { code: "role_fit", severity: "hard", message: "A kitchen porter cannot take a chef shift." };
  }
  if (person.skills.length && !person.skills.includes(shiftRole) && shiftRole !== person.roleCode) {
    return { code: "role_fit", severity: "hard", message: "This shift is outside the roles this person can cover." };
  }
  return null;
}

export function reviewTake(person: PersonRule, shift: ShiftSlot, existing: ShiftSlot[], house: HouseRules): Violation[] {
  const violations: Violation[] = [];
  const fit = roleFit(person, shift.roleCode, house);
  if (fit) violations.push(fit);
  if (person.unavailable.includes(shift.date)) {
    violations.push({ code: "unavailable", severity: "hard", message: "That date is marked unavailable." });
  }
  if (person.earliestStart && clock(shift.start) < person.earliestStart) {
    violations.push({ code: "earliest_start", severity: "hard", message: `The earliest start for this person is ${person.earliestStart}.` });
  }
  const others = existing.filter(slot => slot.userId === person.userId && slot.id !== shift.id);
  for (const other of others) {
    if (restGapHours(other, shift) < house.minRestHours) {
      violations.push({ code: "min_rest", severity: "hard", message: `Fewer than ${house.minRestHours} hours between shifts.` });
      break;
    }
  }
  const after = others.concat([{ ...shift, userId: person.userId }]);
  const before = others;
  const week = weekStartMonday(shift.date);
  const month = shift.date.slice(0, 7);
  const weeklyAfter = sumHours(after, slot => weekStartMonday(slot.date) === week);
  const weeklyBefore = sumHours(before, slot => weekStartMonday(slot.date) === week);
  const monthlyAfter = sumHours(after, slot => slot.date.slice(0, 7) === month);
  if (person.weeklyCap != null && weeklyAfter > person.weeklyCap) {
    violations.push({ code: "weekly_cap", severity: "hard", message: `This goes over the weekly cap of ${person.weeklyCap} hours.` });
  } else if (weeklyAfter > house.standardWeekHours && weeklyAfter > weeklyBefore) {
    const lieuBefore = lieuHours(weeklyBefore, house.standardWeekHours);
    const lieuAfter = lieuHours(weeklyAfter, house.standardWeekHours);
    violations.push({ code: "standard_week", severity: "warn", message: `Over the ${house.standardWeekHours}-hour week. Lieu moves from ${lieuBefore} to ${lieuAfter} hours.` });
  }
  if (person.monthlyCap != null && monthlyAfter > person.monthlyCap) {
    violations.push({ code: "monthly_cap", severity: "hard", message: `This goes over the monthly cap of ${person.monthlyCap} hours.` });
  }
  if (!person.cleared) {
    violations.push({ code: "not_cleared", severity: "warn", message: "Not cleared for unsupervised work." });
  }
  return violations;
}

export function hardBlocks(violations: Violation[]): Violation[] {
  return violations.filter(item => item.severity === "hard");
}

function hoursEffect(userId: string, before: ShiftSlot[], after: ShiftSlot[], anchor: string, house: HouseRules): HoursEffect {
  const week = weekStartMonday(anchor);
  const month = anchor.slice(0, 7);
  const weeklyBefore = sumHours(before, slot => weekStartMonday(slot.date) === week);
  const weeklyAfter = sumHours(after, slot => weekStartMonday(slot.date) === week);
  return {
    userId,
    weekStart: week,
    weeklyBefore,
    weeklyAfter,
    lieuBefore: lieuHours(weeklyBefore, house.standardWeekHours),
    lieuAfter: lieuHours(weeklyAfter, house.standardWeekHours),
    monthlyBefore: sumHours(before, slot => slot.date.slice(0, 7) === month),
    monthlyAfter: sumHours(after, slot => slot.date.slice(0, 7) === month),
  };
}

function owned(slots: ShiftSlot[], userId: string, dropId: string | null): ShiftSlot[] {
  return slots.filter(slot => slot.userId === userId && slot.id !== dropId);
}

export function planAssignments(input: {
  kind: SwapKind;
  requester: PersonRule;
  shift: ShiftSlot;
  partner: PersonRule | null;
  partnerShift: ShiftSlot | null;
  claimer: PersonRule | null;
  roster: ShiftSlot[];
  house: HouseRules;
  cancelUncovered?: boolean;
}): SwapPlan {
  const fail = (violations: Violation[]): SwapPlan => ({ ok: false, violations, assignments: [] });
  if (input.shift.userId !== input.requester.userId) return fail([{ code: "owner", severity: "hard", message: "That shift is not theirs to move." }]);
  const assignments: Assignment[] = [];
  const warnings: Violation[] = [];
  const hours: HoursEffect[] = [];

  if (input.kind === "swap") {
    if (!input.partner || !input.partnerShift) return fail([{ code: "partner", severity: "hard", message: "A two-way swap needs the other person and their shift." }]);
    if (input.partnerShift.userId !== input.partner.userId) return fail([{ code: "partner", severity: "hard", message: "The other shift does not belong to that person." }]);
    const requesterAfter = owned(input.roster, input.requester.userId, input.shift.id).concat([{ ...input.partnerShift, userId: input.requester.userId }]);
    const partnerAfter = owned(input.roster, input.partner.userId, input.partnerShift.id).concat([{ ...input.shift, userId: input.partner.userId }]);
    const requesterIssues = reviewTake(input.requester, { ...input.partnerShift, userId: input.requester.userId }, requesterAfter, input.house);
    const partnerIssues = reviewTake(input.partner, { ...input.shift, userId: input.partner.userId }, partnerAfter, input.house);
    const issues = requesterIssues.concat(partnerIssues);
    if (hardBlocks(issues).length) return fail(issues);
    warnings.push(...issues.filter(item => item.severity === "warn"));
    assignments.push(
      { shiftId: input.shift.id, fromUserId: input.requester.userId, toUserId: input.partner.userId },
      { shiftId: input.partnerShift.id, fromUserId: input.partner.userId, toUserId: input.requester.userId },
    );
    hours.push(
      hoursEffect(input.requester.userId, owned(input.roster, input.requester.userId, null), requesterAfter, input.partnerShift.date, input.house),
      hoursEffect(input.partner.userId, owned(input.roster, input.partner.userId, null), partnerAfter, input.shift.date, input.house),
    );
    return { ok: true, assignments, warnings, hours };
  }

  const cover = input.claimer ?? input.partner;
  if (!cover) {
    if (input.kind === "day_off" && input.cancelUncovered) {
      return { ok: true, assignments: [], warnings: [{ code: "uncovered", severity: "warn", message: "The shift will be cancelled with nobody covering it." }], hours: [] };
    }
    return fail([{ code: "cover", severity: "hard", message: "Somebody has to take the shift before it can be approved." }]);
  }
  const after = owned(input.roster, cover.userId, null).concat([{ ...input.shift, userId: cover.userId }]);
  const issues = reviewTake(cover, { ...input.shift, userId: cover.userId }, after, input.house);
  if (hardBlocks(issues).length) return fail(issues);
  warnings.push(...issues.filter(item => item.severity === "warn"));
  assignments.push({ shiftId: input.shift.id, fromUserId: input.requester.userId, toUserId: cover.userId });
  hours.push(hoursEffect(cover.userId, owned(input.roster, cover.userId, null), after, input.shift.date, input.house));
  const requesterBefore = owned(input.roster, input.requester.userId, null);
  const requesterAfter = owned(input.roster, input.requester.userId, input.shift.id);
  hours.push(hoursEffect(input.requester.userId, requesterBefore, requesterAfter, input.shift.date, input.house));
  return { ok: true, assignments, warnings, hours };
}

/** Applying a failed plan changes nothing. A plan is applied as a whole or not at all. */
export function applyPlan(roster: ShiftSlot[], plan: SwapPlan): ShiftSlot[] | null {
  if (!plan.ok) return null;
  const next = roster.map(slot => ({ ...slot }));
  for (const change of plan.assignments) {
    const row = next.find(slot => slot.id === change.shiftId);
    if (!row || row.userId !== change.fromUserId) return null;
    row.userId = change.toUserId;
    row.roleCode = row.roleCode;
  }
  return next;
}

export type SwapRecord = {
  kind: SwapKind;
  status: SwapStatus;
  requesterId: string;
  shiftId: string;
  partnerId: string | null;
  partnerShiftId: string | null;
  claimerId: string | null;
  open: boolean;
  reason: string;
  history: { action: string; status: SwapStatus; by: string; note: string }[];
};

export function createSwap(input: {
  kind: SwapKind;
  requesterId: string;
  shiftId: string;
  partnerId?: string | null;
  partnerShiftId?: string | null;
  reason?: string;
  by: string;
  manager?: boolean;
}): { ok: true; request: SwapRecord } | { ok: false; error: string } {
  if (!SWAP_KINDS.includes(input.kind)) return { ok: false, error: "Choose a swap, a cover, or a day off." };
  if (input.partnerId && input.partnerId === input.requesterId) return { ok: false, error: "Choose somebody else." };
  if (input.kind === "swap" && (!input.partnerId || !input.partnerShiftId)) return { ok: false, error: "A two-way swap needs the other person and their shift." };
  const open = !input.partnerId;
  const ready = !!input.manager && !open;
  const request: SwapRecord = {
    kind: input.kind,
    status: ready ? "accepted" : "pending",
    requesterId: input.requesterId,
    shiftId: input.shiftId,
    partnerId: input.partnerId ?? null,
    partnerShiftId: input.kind === "swap" ? input.partnerShiftId ?? null : null,
    claimerId: ready ? input.partnerId ?? null : null,
    open,
    reason: String(input.reason ?? "").trim().slice(0, 500),
    history: [{ action: input.manager ? "manager_open" : "create", status: ready ? "accepted" : "pending", by: input.by, note: "" }],
  };
  return { ok: true, request };
}

export function transition(request: SwapRecord, action: "accept" | "decline" | "claim" | "cancel" | "approve" | "reject" | "expire", by: string, note = ""): { ok: true; request: SwapRecord } | { ok: false; error: string } {
  let status: SwapStatus | null = null;
  if (action === "accept" && request.status === "pending" && request.partnerId && by === request.partnerId) status = "accepted";
  if (action === "decline" && request.status === "pending" && request.partnerId && by === request.partnerId) status = "declined";
  if (action === "claim" && request.status === "pending" && request.open && by !== request.requesterId) status = "accepted";
  if (action === "cancel" && (request.status === "pending" || request.status === "accepted") && by === request.requesterId) status = "cancelled";
  if (action === "approve" && request.status === "accepted") status = "approved";
  if (action === "approve" && request.status === "pending" && request.kind === "day_off" && !request.partnerId && !request.claimerId) status = "approved";
  if (action === "reject" && (request.status === "pending" || request.status === "accepted")) status = "rejected";
  if (action === "expire" && (request.status === "pending" || request.status === "accepted")) status = "expired";
  if (!status) return { ok: false, error: "That step is not available." };
  return {
    ok: true,
    request: {
      ...request,
      status,
      claimerId: action === "claim" ? by : request.claimerId ?? (action === "accept" ? request.partnerId : request.claimerId),
      history: request.history.concat([{ action, status, by, note: note.slice(0, 500) }]),
    },
  };
}

export function shouldExpire(slot: Pick<ShiftSlot, "date" | "start">, hoursBefore: number, nowMs: number): boolean {
  const start = Date.parse(`${slot.date}T${clock(slot.start)}:00Z`);
  return nowMs >= start - hoursBefore * 3_600_000;
}

export function eligibleForBoard(person: PersonRule, shift: ShiftSlot, roster: ShiftSlot[], house: HouseRules): boolean {
  if (person.userId === shift.userId) return false;
  return hardBlocks(reviewTake(person, shift, roster.filter(slot => slot.userId === person.userId).concat([{ ...shift, userId: person.userId }]), house)).length === 0;
}

export type SwapNotice = { toUserId: string; subject: string; body: string };

export function noticesFor(event: "created" | "accepted" | "declined" | "approved" | "rejected" | "cancelled" | "claimed" | "expired", input: {
  requesterId: string;
  partnerId?: string | null;
  claimerId?: string | null;
  managerId?: string | null;
  requesterName: string;
  when: string;
}): SwapNotice[] {
  const line = `${input.requesterName} · ${input.when}`;
  const people = new Set<string>();
  const notes: SwapNotice[] = [];
  const add = (id: string | null | undefined, subject: string, body: string) => {
    if (!id || people.has(id)) return;
    people.add(id);
    notes.push({ toUserId: id, subject, body });
  };
  if (event === "created" && input.partnerId) add(input.partnerId, "A shift swap needs your answer", `${line} asked to swap. Accept or decline on the pocket.`);
  if (event === "created" && !input.partnerId) add(input.managerId, "An open shift is on the board", `${line} posted a shift. Eligible staff can claim it.`);
  if (event === "claimed") {
    add(input.requesterId, "Someone claimed your shift", `A colleague claimed the shift you posted (${input.when}). A manager still has to approve it.`);
    add(input.managerId, "A claimed shift needs approval", `${line} has a claim waiting.`);
  }
  if (event === "accepted") {
    add(input.requesterId, "Your swap was accepted", `The other person accepted (${input.when}). A manager still has to approve it.`);
    add(input.managerId, "A swap needs approval", `${line} is ready for a decision.`);
  }
  if (event === "declined") add(input.requesterId, "Your swap was declined", `The other person declined (${input.when}).`);
  if (event === "approved") {
    add(input.requesterId, "Your swap was approved", `The rota now shows the change for ${input.when}.`);
    add(input.partnerId, "A swap you agreed was approved", `The rota now shows the change for ${input.when}.`);
    add(input.claimerId, "The shift you claimed was approved", `The rota now shows you on ${input.when}.`);
  }
  if (event === "rejected") {
    add(input.requesterId, "Your swap was not approved", `A manager left the rota as it was (${input.when}).`);
    add(input.partnerId ?? input.claimerId, "A swap was not approved", `The rota was left as it was (${input.when}).`);
  }
  if (event === "cancelled") add(input.partnerId ?? input.claimerId, "A swap was cancelled", `${input.requesterName} cancelled the request for ${input.when}.`);
  if (event === "expired") add(input.requesterId, "A swap expired", `The request for ${input.when} was still open when the shift came due.`);
  return notes;
}

export function filterSwaps<T extends { status: string; kind: string }>(items: T[], query: { status?: string; kind?: string }): T[] {
  return items.filter(item => (!query.status || item.status === query.status) && (!query.kind || item.kind === query.kind));
}
