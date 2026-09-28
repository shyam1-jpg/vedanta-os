/** Shift swaps. Names and personal caps come from the database or a gitignored file, never from this source. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { pool, tx, type Q } from "./db.ts";
import { requireActor, allow, problem, type Actor } from "./auth.ts";
import { audit } from "./groups.ts";
import { sendEmail } from "./email.ts";
import { clearanceForUsers } from "./training.ts";
import {
  applyPlan,
  createSwap,
  eligibleForBoard,
  hardBlocks,
  noticesFor,
  parseConstraintFile,
  parseHouseRules,
  planAssignments,
  reviewTake,
  shouldExpire,
  transition,
  type ConstraintRow,
  type HoursEffect,
  type HouseRules,
  type PersonRule,
  type ShiftSlot,
  type SwapKind,
  type SwapNotice,
  type SwapPlan,
  type SwapRecord,
  type Violation,
} from "../../../domains/staff/shiftSwap.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

class Halt extends Error {
  constructor(public status: number, public code: string, public detail: string, public violations: Violation[] = []) {
    super(detail);
  }
}

type Staff = PersonRule & { name: string; email: string };
type SwapRow = {
  id: string;
  kind: SwapKind;
  status: SwapRecord["status"];
  requester_id: string;
  shift_id: string;
  partner_id: string | null;
  partner_shift_id: string | null;
  claimer_id: string | null;
  reason: string;
  open: boolean;
  manager_note: string | null;
  source: string;
  created_at: string;
  decided_at: string | null;
};

function clock(value: string | null | undefined): string | null {
  if (!value) return null;
  return String(value).slice(0, 5);
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "A colleague";
}

function whenLabel(slot: Pick<ShiftSlot, "date" | "start">): string {
  const [y, m, d] = slot.date.split("-").map(Number);
  const day = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12));
  const label = day.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return `${label} ${clock(slot.start) ?? ""}`.trim();
}

function asDates(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    if (item instanceof Date) return item.toISOString().slice(0, 10);
    return String(item).slice(0, 10);
  }).filter(item => DATE.test(item));
}

function fileConstraints(): ConstraintRow[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const files = [
    path.resolve(here, "../../../config/rota-constraints.json"),
    path.resolve(process.cwd(), "config/rota-constraints.json"),
  ];
  for (const file of files) {
    try {
      return parseConstraintFile(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch {
      continue;
    }
  }
  return [];
}

function settingsBody(house: HouseRules) {
  return {
    min_rest_hours: house.minRestHours,
    standard_week_hours: house.standardWeekHours,
    expire_hours_before: house.expireHoursBefore,
  };
}

async function loadHouse(propertyId: string): Promise<HouseRules> {
  const row = (await pool.query(`select settings from property where id=$1`, [propertyId])).rows[0];
  return parseHouseRules(row?.settings?.shift_swap);
}

async function londonNow(): Promise<{ today: string; nowMs: number }> {
  const row = (await pool.query(
    `select to_char(timezone('Europe/London', now()), 'YYYY-MM-DD') as today,
            to_char(timezone('Europe/London', now()), 'YYYY-MM-DD"T"HH24:MI:SS') as local`,
  )).rows[0];
  return { today: row.today, nowMs: Date.parse(`${row.local}Z`) };
}

async function loadContext(propertyId: string) {
  const house = await loadHouse(propertyId);
  const clockNow = await londonNow();
  const memberships = (await pool.query(
    `select u.id, u.email, u.display_name, r.code as role_code
     from membership m
     join app_user u on u.id = m.user_id
     join role r on r.id = m.role_id
     where m.property_id = $1 and u.status = 'ACTIVE'
     order by u.display_name, r.code`,
    [propertyId],
  )).rows as { id: string; email: string; display_name: string; role_code: string }[];
  const grouped = new Map<string, { email: string; name: string; roles: string[] }>();
  for (const row of memberships) {
    const current = grouped.get(row.id) ?? { email: row.email, name: row.display_name, roles: [] };
    current.roles.push(row.role_code);
    grouped.set(row.id, current);
  }
  const rules = (await pool.query(
    `select user_id, earliest_start::text, weekly_hours_cap, monthly_hours_cap, unavailable_dates, skills
     from staff_rota_rule where property_id=$1`,
    [propertyId],
  )).rows as { user_id: string; earliest_start: string | null; weekly_hours_cap: string | null; monthly_hours_cap: string | null; unavailable_dates: unknown; skills: string[] | null }[];
  const ruleByUser = new Map(rules.map(row => [row.user_id, row]));
  const fileByEmail = new Map(fileConstraints().map(row => [row.email, row]));
  const cleared = await clearanceForUsers(propertyId, [...grouped.keys()]);
  const people = new Map<string, Staff>();
  for (const [id, row] of grouped) {
    const role = row.roles.find(code => house.chefRoles.includes(code) || house.kpRoles.includes(code)) ?? row.roles[0] ?? "STAFF";
    const stored = ruleByUser.get(id);
    const file = fileByEmail.get(row.email.trim().toLowerCase());
    const weekly = stored ? (stored.weekly_hours_cap == null ? null : Number(stored.weekly_hours_cap)) : file?.weeklyCap ?? null;
    const monthly = stored ? (stored.monthly_hours_cap == null ? null : Number(stored.monthly_hours_cap)) : file?.monthlyCap ?? null;
    people.set(id, {
      userId: id,
      name: row.name,
      email: row.email,
      roleCode: role,
      earliestStart: stored ? clock(stored.earliest_start) : file?.earliestStart ?? null,
      unavailable: stored ? asDates(stored.unavailable_dates) : file?.unavailable ?? [],
      weeklyCap: weekly != null && Number.isFinite(weekly) ? weekly : null,
      monthlyCap: monthly != null && Number.isFinite(monthly) ? monthly : null,
      skills: stored ? (stored.skills ?? []) : file?.skills ?? [],
      cleared: cleared.get(id) ?? false,
    });
  }
  const shifts = (await pool.query(
    `select id, user_id, role_code, department, shift_date::text as date, start_time::text as start, end_time::text as end, break_minutes
     from rota_shift
     where property_id=$1 and status <> 'cancelled'
       and shift_date between $2::date - 2 and $2::date + 60`,
    [propertyId, clockNow.today],
  )).rows as { id: string; user_id: string; role_code: string | null; department: string; date: string; start: string; end: string; break_minutes: number }[];
  const roster: ShiftSlot[] = shifts.map(row => ({
    id: row.id,
    userId: row.user_id,
    roleCode: row.role_code || people.get(row.user_id)?.roleCode || null,
    department: row.department,
    date: row.date,
    start: row.start,
    end: row.end,
    breakMinutes: Number(row.break_minutes ?? 0),
  }));
  return { house, ...clockNow, people, roster };
}

function upcoming(slot: ShiftSlot, hoursBefore: number, nowMs: number): boolean {
  return !shouldExpire(slot, hoursBefore, nowMs);
}

function recordFrom(row: SwapRow): SwapRecord {
  return {
    kind: row.kind,
    status: row.status,
    requesterId: row.requester_id,
    shiftId: row.shift_id,
    partnerId: row.partner_id,
    partnerShiftId: row.partner_shift_id,
    claimerId: row.claimer_id,
    open: row.open,
    reason: row.reason,
    history: [],
  };
}

function personOf(people: Map<string, Staff>, id: string | null): Staff | null {
  if (!id) return null;
  return people.get(id) ?? null;
}

function reviewFor(row: SwapRow, ctx: Awaited<ReturnType<typeof loadContext>>): { ok: boolean; violations: Violation[]; hours: HoursEffect[] } {
  const shift = ctx.roster.find(slot => slot.id === row.shift_id);
  const requester = personOf(ctx.people, row.requester_id);
  if (!shift || !requester) return { ok: false, violations: [{ code: "missing", severity: "hard", message: "That shift is no longer on the rota." }], hours: [] };
  const partner = personOf(ctx.people, row.partner_id);
  const claimer = personOf(ctx.people, row.claimer_id);
  const partnerShift = row.partner_shift_id ? ctx.roster.find(slot => slot.id === row.partner_shift_id) ?? null : null;
  const plan = planAssignments({
    kind: row.kind,
    requester,
    shift,
    partner: row.kind === "swap" ? partner : partner,
    partnerShift: row.kind === "swap" ? partnerShift : null,
    claimer: row.kind === "swap" ? null : claimer ?? (row.partner_id ? partner : null),
    roster: ctx.roster,
    house: ctx.house,
    cancelUncovered: row.kind === "day_off" && !row.partner_id && !row.claimer_id,
  });
  if (!plan.ok) return { ok: false, violations: plan.violations, hours: [] };
  return { ok: true, violations: plan.warnings, hours: plan.hours };
}

function present(row: SwapRow, ctx: Awaited<ReturnType<typeof loadContext>>, withReview: boolean) {
  const name = (id: string | null) => id ? (ctx.people.get(id)?.name ?? "Former colleague") : null;
  const shift = ctx.roster.find(slot => slot.id === row.shift_id) ?? null;
  const partnerShift = row.partner_shift_id ? ctx.roster.find(slot => slot.id === row.partner_shift_id) ?? null : null;
  const review = withReview ? reviewFor(row, ctx) : null;
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    open: row.open,
    reason: row.reason,
    manager_note: row.manager_note,
    source: row.source,
    created_at: row.created_at,
    requester: { id: row.requester_id, name: name(row.requester_id) },
    partner: row.partner_id ? { id: row.partner_id, name: name(row.partner_id) } : null,
    claimer: row.claimer_id ? { id: row.claimer_id, name: name(row.claimer_id) } : null,
    shift: shift && { id: shift.id, user_id: shift.userId, date: shift.date, start: clock(shift.start), end: clock(shift.end), role_code: shift.roleCode, department: shift.department },
    partner_shift: partnerShift && { id: partnerShift.id, user_id: partnerShift.userId, date: partnerShift.date, start: clock(partnerShift.start), end: clock(partnerShift.end), role_code: partnerShift.roleCode, department: partnerShift.department },
    review,
  };
}

async function managerIds(propertyId: string): Promise<string[]> {
  const rows = (await pool.query(
    `select distinct u.id
     from membership m
     join app_user u on u.id = m.user_id
     join role_permission rp on rp.role_id = m.role_id and rp.permission_code = 'shift.swap.manage'
     where m.property_id = $1 and u.status = 'ACTIVE'`,
    [propertyId],
  )).rows as { id: string }[];
  return rows.map(row => row.id);
}

function withManagers(notes: SwapNotice[], managers: string[]): SwapNotice[] {
  const hit = notes.find(note => managers.includes(note.toUserId));
  if (!hit) return notes;
  return notes.concat(managers.filter(id => id !== hit.toUserId).map(id => ({ ...hit, toUserId: id })));
}

async function deliver(a: { tenantId: string; propertyId: string; userId?: string | null }, notes: SwapNotice[], swapId: string) {
  const ids = [...new Set(notes.map(note => note.toUserId))];
  if (!ids.length) return;
  const rows = (await pool.query(`select id, email from app_user where id = any($1::uuid[]) and status = 'ACTIVE'`, [ids])).rows as { id: string; email: string }[];
  const email = new Map(rows.map(row => [row.id, row.email]));
  for (const note of notes) {
    const to = email.get(note.toUserId);
    if (!to) continue;
    await sendEmail(a, { to, subject: note.subject, body: note.body, kind: "shift_swap", related_type: "shift_swap", related_id: swapId });
  }
}

function noticeInput(ctx: Awaited<ReturnType<typeof loadContext>>, request: SwapRecord, managers: string[]) {
  const shift = ctx.roster.find(slot => slot.id === request.shiftId);
  const requester = ctx.people.get(request.requesterId);
  return {
    requesterId: request.requesterId,
    partnerId: request.partnerId,
    claimerId: request.claimerId,
    managerId: managers[0] ?? null,
    requesterName: firstName(requester?.name ?? "A colleague"),
    when: shift ? whenLabel(shift) : "the shift",
  };
}

async function busyShift(db: { query: Q["query"] }, propertyId: string, shiftIds: string[]): Promise<boolean> {
  const ids = shiftIds.filter(Boolean);
  if (!ids.length) return false;
  const row = (await db.query(
    `select 1 from shift_swap
     where property_id=$1 and status in ('pending','accepted')
       and (shift_id = any($2::uuid[]) or partner_shift_id = any($2::uuid[]))
     limit 1`,
    [propertyId, ids],
  )).rows[0];
  return !!row;
}

function planFor(request: SwapRecord, ctx: Awaited<ReturnType<typeof loadContext>>): SwapPlan {
  const shift = ctx.roster.find(slot => slot.id === request.shiftId);
  const requester = personOf(ctx.people, request.requesterId);
  if (!shift || !requester || shift.userId !== requester.userId) {
    return { ok: false, assignments: [], violations: [{ code: "owner", severity: "hard", message: "That shift is not theirs to move." }] };
  }
  const partner = personOf(ctx.people, request.partnerId);
  const claimer = personOf(ctx.people, request.claimerId);
  const partnerShift = request.partnerShiftId ? ctx.roster.find(slot => slot.id === request.partnerShiftId) ?? null : null;
  return planAssignments({
    kind: request.kind,
    requester,
    shift,
    partner,
    partnerShift: request.kind === "swap" ? partnerShift : null,
    claimer: request.kind === "swap" ? null : (claimer ?? partner),
    roster: ctx.roster,
    house: ctx.house,
    cancelUncovered: request.kind === "day_off" && !request.partnerId && !request.claimerId,
  });
}

async function insertEvent(c: Q, swapId: string, fromStatus: string | null, toStatus: string, action: string, note: string, by: string | null, payload: object) {
  await c.query(
    `insert into shift_swap_event (swap_id, from_status, to_status, action, note, by_user_id, payload)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [swapId, fromStatus, toStatus, action, note.slice(0, 500), by && UUID.test(by) ? by : null, JSON.stringify(payload)],
  );
}

async function applyApproval(c: Q, a: Actor, swapId: string, before: SwapRow, request: SwapRecord, note: string, ctx: Awaited<ReturnType<typeof loadContext>>) {
  const shiftIds = [request.shiftId, request.partnerShiftId].filter((id): id is string => !!id);
  const locked = (await c.query(
    `select id, user_id, role_code, department, shift_date::text as date, start_time::text as start, end_time::text as end, break_minutes, status
     from rota_shift where property_id=$1 and id = any($2::uuid[]) for update`,
    [a.propertyId, shiftIds],
  )).rows as { id: string; user_id: string; role_code: string | null; department: string; date: string; start: string; end: string; break_minutes: number; status: string }[];
  const roster = ctx.roster.map(slot => {
    const fresh = locked.find(row => row.id === slot.id);
    return fresh ? { ...slot, userId: fresh.user_id, roleCode: fresh.role_code || slot.roleCode, breakMinutes: Number(fresh.break_minutes ?? 0) } : slot;
  });
  const live = { ...ctx, roster };
  const plan = planFor(request, live);
  if (!plan.ok) throw new Halt(422, "rule", plan.violations.find(item => item.severity === "hard")?.message ?? "This swap breaks a rota rule.", plan.violations);
  const applied = applyPlan(roster, plan);
  if (plan.assignments.length && !applied) throw new Halt(409, "conflict", "The rota changed while this was being approved.");
  if (!plan.assignments.length) {
    const cancelled = await c.query(
      `update rota_shift set status='cancelled' where id=$1 and user_id=$2 and property_id=$3 and status <> 'cancelled' returning id`,
      [request.shiftId, request.requesterId, a.propertyId],
    );
    if (!cancelled.rowCount) throw new Halt(409, "conflict", "The rota changed while this was being approved.");
    await c.query(
      `insert into shift_swap_assignment (swap_id, shift_id, from_user_id, to_user_id) values ($1,$2,$3,null)`,
      [swapId, request.shiftId, request.requesterId],
    );
    await audit(c, a, "rota_shift", request.shiftId, "cancel", { from: request.requesterId, to: "cancelled", reason: note, payload: { swap_id: swapId } });
  }
  for (const change of plan.assignments) {
    const updated = await c.query(
      `update rota_shift set user_id=$1, status='swapped' where id=$2 and user_id=$3 and property_id=$4 returning id`,
      [change.toUserId, change.shiftId, change.fromUserId, a.propertyId],
    );
    if (!updated.rowCount) throw new Halt(409, "conflict", "The rota changed while this was being approved.");
    await c.query(
      `insert into shift_swap_assignment (swap_id, shift_id, from_user_id, to_user_id) values ($1,$2,$3,$4)`,
      [swapId, change.shiftId, change.fromUserId, change.toUserId],
    );
    await audit(c, a, "rota_shift", change.shiftId, "swap", { from: change.fromUserId, to: change.toUserId, reason: note, payload: { swap_id: swapId } });
  }
  await c.query(
    `update shift_swap set status='approved', claimer_id=$2, manager_note=$3, decided_by=$4, decided_at=now() where id=$1`,
    [swapId, request.claimerId, note || null, a.userId],
  );
  await insertEvent(c, swapId, before.status, "approved", "approve", note, a.userId, { assignments: plan.assignments, hours: plan.hours, warnings: plan.warnings });
  await audit(c, a, "shift_swap", swapId, "approve", { from: before.status, to: "approved", reason: note, payload: { assignments: plan.assignments, hours: plan.hours } });
  return plan;
}

async function readSwap(propertyId: string, id: string): Promise<SwapRow | null> {
  const row = (await pool.query(
    `select id, kind, status, requester_id, shift_id, partner_id, partner_shift_id, claimer_id, reason, open, manager_note, source, created_at, decided_at
     from shift_swap where id=$1 and property_id=$2`,
    [id, propertyId],
  )).rows[0] as SwapRow | undefined;
  return row ?? null;
}

function haltReply(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, err: Halt) {
  const detail = err.violations.length
    ? err.violations.map(item => `${item.severity === "hard" ? "Blocked" : "Warning"}: ${item.message}`).join(" ")
    : err.detail;
  return reply.code(err.status).send(problem(err.status, err.code, detail, { violations: err.violations }));
}

export async function expireShiftSwaps(propertyId: string): Promise<number> {
  const prop = (await pool.query(`select tenant_id from property where id=$1`, [propertyId])).rows[0] as { tenant_id: string } | undefined;
  if (!prop) return 0;
  const ctx = await loadContext(propertyId);
  const rows = (await pool.query(
    `select s.id, rs.shift_date::text as date, rs.start_time::text as start
     from shift_swap s
     join rota_shift rs on rs.id = s.shift_id
     where s.property_id=$1 and s.status in ('pending','accepted')`,
    [propertyId],
  )).rows as { id: string; date: string; start: string }[];
  let expired = 0;
  for (const row of rows) {
    if (!shouldExpire(row, ctx.house.expireHoursBefore, ctx.nowMs)) continue;
    try {
      const notes = await tx(async c => {
        const locked = (await c.query(
          `select id, kind, status, requester_id, shift_id, partner_id, partner_shift_id, claimer_id, reason, open, manager_note, source, created_at, decided_at
           from shift_swap where id=$1 and property_id=$2 for update`,
          [row.id, propertyId],
        )).rows[0] as SwapRow | undefined;
        if (!locked) return [] as SwapNotice[];
        const next = transition(recordFrom(locked), "expire", "system");
        if (!next.ok) return [] as SwapNotice[];
        await c.query(`update shift_swap set status='expired', decided_at=now() where id=$1`, [locked.id]);
        await insertEvent(c, locked.id, locked.status, "expired", "expire", "", null, {});
        const managers = await managerIds(propertyId);
        return noticesFor("expired", noticeInput(ctx, next.request, managers));
      });
      if (notes.length) {
        expired += 1;
        await deliver({ tenantId: prop.tenant_id, propertyId, userId: null }, notes, row.id);
      }
    } catch (err) {
      console.error("[shift-swap] expire failed", err instanceof Error ? err.message : err);
    }
  }
  return expired;
}

export default async function shiftSwapRoutes(f: FastifyInstance) {
  f.get("/v1/settings/shift-swap", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a) return;
    if (!a.perms.has("shift.swap.manage") && !a.perms.has("package.manage")) {
      return reply.code(403).send(problem(403, "forbidden", "You cannot open shift swap settings"));
    }
    return settingsBody(await loadHouse(a.propertyId));
  });

  f.put("/v1/settings/shift-swap", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "package.manage", reply)) return;
    const house = parseHouseRules(req.body ?? {});
    await pool.query(
      `update property set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{shift_swap}', $2::jsonb, true) where id=$1`,
      [a.propertyId, JSON.stringify(settingsBody(house))],
    );
    return settingsBody(house);
  });

  f.get("/v1/shift-swaps/mine", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "shift.swap", reply)) return;
    const ctx = await loadContext(a.propertyId);
    const rows = (await pool.query(
      `select id, kind, status, requester_id, shift_id, partner_id, partner_shift_id, claimer_id, reason, open, manager_note, source, created_at, decided_at
       from shift_swap where property_id=$1 and (requester_id=$2 or partner_id=$2 or claimer_id=$2 or (open and status='pending'))
       order by created_at desc limit 80`,
      [a.propertyId, a.userId],
    )).rows as SwapRow[];
    const mine = (slot: ShiftSlot) => ({
      id: slot.id, user_id: slot.userId, name: ctx.people.get(slot.userId)?.name ?? "Colleague",
      date: slot.date, start: clock(slot.start), end: clock(slot.end), role_code: slot.roleCode, department: slot.department,
    });
    const shifts = ctx.roster.filter(slot => slot.userId === a.userId && upcoming(slot, ctx.house.expireHoursBefore, ctx.nowMs));
    const colleagueShifts = ctx.roster.filter(slot => slot.userId !== a.userId && upcoming(slot, ctx.house.expireHoursBefore, ctx.nowMs));
    const board = rows.filter(row => row.open && row.status === "pending" && row.requester_id !== a.userId).flatMap(row => {
      const shift = ctx.roster.find(slot => slot.id === row.shift_id);
      const person = ctx.people.get(a.userId);
      if (!shift || !person || !eligibleForBoard(person, shift, ctx.roster, ctx.house)) return [];
      const issues = reviewTake(person, { ...shift, userId: person.userId }, ctx.roster.filter(slot => slot.userId === person.userId).concat([{ ...shift, userId: person.userId }]), ctx.house);
      return [{ ...present(row, ctx, false), warnings: issues.filter(item => item.severity === "warn") }];
    });
    return {
      can_manage: a.perms.has("shift.swap.manage"),
      shifts: shifts.map(mine),
      colleague_shifts: colleagueShifts.map(mine),
      colleagues: [...ctx.people.values()].filter(person => person.userId !== a.userId).map(person => ({ id: person.userId, name: person.name, role: person.roleCode })),
      requests: rows.filter(row => row.requester_id === a.userId).map(row => present(row, ctx, row.status === "pending" || row.status === "accepted")),
      incoming: rows.filter(row => row.partner_id === a.userId && row.status === "pending").map(row => present(row, ctx, true)),
      board,
    };
  });

  f.get("/v1/shift-swaps/directory", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "shift.swap.manage", reply)) return;
    const ctx = await loadContext(a.propertyId);
    return {
      staff: [...ctx.people.values()].map(person => ({ id: person.userId, name: person.name, role: person.roleCode, cleared: person.cleared })),
      shifts: ctx.roster.filter(slot => upcoming(slot, ctx.house.expireHoursBefore, ctx.nowMs)).map(slot => ({
        id: slot.id, user_id: slot.userId, name: ctx.people.get(slot.userId)?.name ?? "Colleague",
        date: slot.date, start: clock(slot.start), end: clock(slot.end), role_code: slot.roleCode, department: slot.department,
      })),
    };
  });

  f.get("/v1/shift-swaps/rules", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "shift.swap.manage", reply)) return;
    const ctx = await loadContext(a.propertyId);
    return {
      items: [...ctx.people.values()].map(person => ({
        user_id: person.userId,
        name: person.name,
        role: person.roleCode,
        cleared: person.cleared,
        earliest_start: person.earliestStart,
        weekly_hours_cap: person.weeklyCap,
        monthly_hours_cap: person.monthlyCap,
        unavailable: person.unavailable,
        skills: person.skills,
      })),
    };
  });

  f.put<{ Params: { userId: string } }>("/v1/shift-swaps/rules/:userId", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "shift.swap.manage", reply)) return;
    if (!UUID.test(req.params.userId)) return reply.code(422).send(problem(422, "validation", "Choose a member of staff"));
    const member = (await pool.query(`select 1 from membership where property_id=$1 and user_id=$2`, [a.propertyId, req.params.userId])).rows[0];
    if (!member) return reply.code(404).send(problem(404, "not_found", "That person is not on this property"));
    const body = (req.body ?? {}) as Record<string, unknown>;
    const earliest = clock(String(body.earliest_start ?? ""));
    const weekly = Number(body.weekly_hours_cap);
    const monthly = Number(body.monthly_hours_cap);
    const unavailable = Array.isArray(body.unavailable) ? body.unavailable.map(v => String(v)).filter(v => DATE.test(v)) : [];
    const skills = Array.isArray(body.skills) ? body.skills.map(v => String(v).trim()).filter(Boolean).slice(0, 20) : [];
    await pool.query(
      `insert into staff_rota_rule (user_id, tenant_id, property_id, earliest_start, weekly_hours_cap, monthly_hours_cap, unavailable_dates, skills)
       values ($1,$2,$3,$4,$5,$6,$7::date[],$8::text[])
       on conflict (user_id) do update set
         property_id=excluded.property_id, earliest_start=excluded.earliest_start,
         weekly_hours_cap=excluded.weekly_hours_cap, monthly_hours_cap=excluded.monthly_hours_cap,
         unavailable_dates=excluded.unavailable_dates, skills=excluded.skills, updated_at=now()`,
      [
        req.params.userId, a.tenantId, a.propertyId,
        earliest && /^([01]\d|2[0-3]):[0-5]\d$/.test(earliest) ? earliest : null,
        Number.isFinite(weekly) && weekly > 0 ? weekly : null,
        Number.isFinite(monthly) && monthly > 0 ? monthly : null,
        unavailable, skills,
      ],
    );
    return { ok: true };
  });

  f.post("/v1/shift-swaps/check", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "shift.swap", reply)) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ctx = await loadContext(a.propertyId);
    const built = buildRequest(a, body, false);
    if (!built.ok) return { ok: false, violations: [{ code: "validation", severity: "hard" as const, message: built.error }] };
    if (!built.request.partnerId) {
      const warnings: Violation[] = built.request.kind === "day_off"
        ? [{ code: "uncovered", severity: "warn", message: "Nobody is named. Eligible staff can claim it, or a manager can cancel the shift with nobody covering." }]
        : [];
      return { ok: true, violations: warnings, hours: [] };
    }
    const plan = planFor(built.request, ctx);
    if (!plan.ok) return { ok: false, violations: plan.violations };
    return { ok: true, violations: plan.warnings, hours: plan.hours };
  });

  f.get("/v1/shift-swaps", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "shift.swap.manage", reply)) return;
    const query = (req.query ?? {}) as { status?: string; kind?: string };
    const ctx = await loadContext(a.propertyId);
    const rows = (await pool.query(
      `select id, kind, status, requester_id, shift_id, partner_id, partner_shift_id, claimer_id, reason, open, manager_note, source, created_at, decided_at
       from shift_swap
       where property_id=$1
         and ($2::text is null or status=$2)
         and ($3::text is null or kind=$3)
       order by created_at desc limit 200`,
      [a.propertyId, query.status || null, query.kind || null],
    )).rows as SwapRow[];
    return { items: rows.map(row => present(row, ctx, row.status === "pending" || row.status === "accepted")) };
  });

  f.post("/v1/shift-swaps", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "shift.swap", reply)) return;
    try {
      const saved = await openRequest(a, (req.body ?? {}) as Record<string, unknown>, false);
      return saved;
    } catch (err) {
      if (err instanceof Halt) return haltReply(reply, err);
      throw err;
    }
  });

  f.post("/v1/shift-swaps/reassign", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "shift.swap.manage", reply)) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const saved = await openRequest(a, body, true);
      if (body.approve === true && saved.id) {
        const decided = await decide(a, saved.id, "approve", String(body.note ?? ""));
        return decided;
      }
      return saved;
    } catch (err) {
      if (err instanceof Halt) return haltReply(reply, err);
      throw err;
    }
  });

  f.get<{ Params: { id: string } }>("/v1/shift-swaps/:id", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "shift.swap", reply)) return;
    if (!UUID.test(req.params.id)) return reply.code(404).send(problem(404, "not_found", "No such swap"));
    const row = await readSwap(a.propertyId, req.params.id);
    if (!row) return reply.code(404).send(problem(404, "not_found", "No such swap"));
    if (!a.perms.has("shift.swap.manage") && row.requester_id !== a.userId && row.partner_id !== a.userId && row.claimer_id !== a.userId) {
      return reply.code(403).send(problem(403, "forbidden", "That swap is not yours"));
    }
    const ctx = await loadContext(a.propertyId);
    const live = row.status === "pending" || row.status === "accepted";
    const events = (await pool.query(
      `select e.action, e.from_status, e.to_status, e.note, e.payload, e.created_at, u.display_name as by_name
       from shift_swap_event e
       left join app_user u on u.id = e.by_user_id
       where e.swap_id=$1 order by e.created_at`,
      [row.id],
    )).rows;
    const assignments = (await pool.query(
      `select shift_id, from_user_id, to_user_id, created_at from shift_swap_assignment where swap_id=$1 order by created_at`,
      [row.id],
    )).rows;
    return { ...present(row, ctx, live), events, assignments };
  });

  for (const action of ["accept", "decline", "claim", "cancel", "approve", "reject"] as const) {
    f.post<{ Params: { id: string } }>(`/v1/shift-swaps/:id/${action}`, async (req, reply) => {
      const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "shift.swap", reply)) return;
      if ((action === "approve" || action === "reject") && !a.perms.has("shift.swap.manage")) {
        return reply.code(403).send(problem(403, "forbidden", "A manager has to decide this"));
      }
      if (!UUID.test(req.params.id)) return reply.code(404).send(problem(404, "not_found", "No such swap"));
      try {
        const note = String((req.body as { note?: string } | undefined)?.note ?? "");
        return await decide(a, req.params.id, action, note);
      } catch (err) {
        if (err instanceof Halt) return haltReply(reply, err);
        throw err;
      }
    });
  }
}

function buildRequest(a: Actor, body: Record<string, unknown>, manager: boolean): { ok: true; request: SwapRecord } | { ok: false; error: string } {
  const kind = String(body.kind ?? "") as SwapKind;
  const requesterId = manager ? String(body.requester_id ?? "") : a.userId;
  const shiftId = String(body.shift_id ?? "");
  if (!UUID.test(requesterId) || !UUID.test(shiftId)) return { ok: false, error: "Choose a shift." };
  const partnerId = body.partner_id ? String(body.partner_id) : null;
  const partnerShiftId = body.partner_shift_id ? String(body.partner_shift_id) : null;
  if (partnerId && !UUID.test(partnerId)) return { ok: false, error: "Choose somebody else." };
  if (partnerShiftId && !UUID.test(partnerShiftId)) return { ok: false, error: "Choose their shift." };
  return createSwap({
    kind,
    requesterId,
    shiftId,
    partnerId,
    partnerShiftId,
    reason: String(body.reason ?? ""),
    by: a.userId,
    manager,
  });
}

async function openRequest(a: Actor, body: Record<string, unknown>, manager: boolean) {
  const ctx = await loadContext(a.propertyId);
  const built = buildRequest(a, body, manager);
  if (!built.ok) throw new Halt(422, "validation", built.error);
  const request = built.request;
  const shift = ctx.roster.find(slot => slot.id === request.shiftId);
  if (!shift || !upcoming(shift, ctx.house.expireHoursBefore, ctx.nowMs)) throw new Halt(422, "validation", "Choose an upcoming shift.");
  if (shift.userId !== request.requesterId) throw new Halt(422, "validation", "That shift is not theirs.");
  if (!ctx.people.has(request.requesterId)) throw new Halt(422, "validation", "Choose a member of staff.");
  if (request.partnerId && !ctx.people.has(request.partnerId)) throw new Halt(422, "validation", "Choose somebody else.");
  if (request.kind === "swap") {
    const partnerShift = ctx.roster.find(slot => slot.id === request.partnerShiftId);
    if (!partnerShift || partnerShift.userId !== request.partnerId || !upcoming(partnerShift, ctx.house.expireHoursBefore, ctx.nowMs)) {
      throw new Halt(422, "validation", "Choose the other person's upcoming shift.");
    }
  }
  const plan = planFor(request, ctx);
  if (request.partnerId && !plan.ok) throw new Halt(422, "rule", plan.violations.find(item => item.severity === "hard")?.message ?? "This swap breaks a rota rule.", plan.violations);
  const warnings = plan.ok ? plan.warnings : [];
  const managers = await managerIds(a.propertyId);
  const saved = await tx(async c => {
    const shiftIds = [request.shiftId, request.partnerShiftId].filter((id): id is string => !!id);
    await c.query(`select id from rota_shift where property_id=$1 and id = any($2::uuid[]) for update`, [a.propertyId, shiftIds]);
    if (await busyShift(c, a.propertyId, shiftIds)) throw new Halt(409, "conflict", "There is already an open request for that shift.");
    const row = (await c.query(
      `insert into shift_swap (tenant_id, property_id, kind, status, requester_id, shift_id, partner_id, partner_shift_id, claimer_id, reason, open, source)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [a.tenantId, a.propertyId, request.kind, request.status, request.requesterId, request.shiftId, request.partnerId, request.partnerShiftId, request.claimerId, request.reason, request.open, manager ? "manager" : "staff"],
    )).rows[0] as { id: string };
    await insertEvent(c, row.id, null, request.status, request.history[0]?.action ?? "create", request.reason, a.userId, { warnings });
    await audit(c, a, "shift_swap", row.id, manager ? "manager_open" : "create", { to: request.status, reason: request.reason });
    return row.id;
  });
  let notes = noticesFor("created", noticeInput(ctx, request, managers));
  if (manager && request.partnerId) {
    const when = noticeInput(ctx, request, managers).when;
    notes = [
      { toUserId: request.requesterId, subject: "A manager started a shift change", body: `A manager started a change for ${when}. It still needs approval.` },
      { toUserId: request.partnerId, subject: "A manager named you on a shift change", body: `A manager named you for ${when}. It still needs approval.` },
    ];
  }
  await deliver(a, withManagers(notes, request.partnerId ? [] : managers), saved);
  const row = await readSwap(a.propertyId, saved);
  return row ? { ...present(row, ctx, true), id: saved } : { id: saved };
}

async function decide(a: Actor, id: string, action: "accept" | "decline" | "claim" | "cancel" | "approve" | "reject", note: string) {
  const ctx = await loadContext(a.propertyId);
  const managers = await managerIds(a.propertyId);
  const outcome = await tx(async c => {
    const locked = (await c.query(
      `select id, kind, status, requester_id, shift_id, partner_id, partner_shift_id, claimer_id, reason, open, manager_note, source, created_at, decided_at
       from shift_swap where id=$1 and property_id=$2 for update`,
      [id, a.propertyId],
    )).rows[0] as SwapRow | undefined;
    if (!locked) throw new Halt(404, "not_found", "No such swap");
    const current = recordFrom(locked);
    if (action === "claim" || action === "accept") {
      const draft = transition(current, action, a.userId, note);
      if (!draft.ok) throw new Halt(422, "validation", draft.error);
      const plan = planFor(draft.request, ctx);
      if (!plan.ok) throw new Halt(422, "rule", hardBlocks(plan.violations)[0]?.message ?? "This swap breaks a rota rule.", plan.violations);
    }
    const next = transition(current, action, a.userId, note);
    if (!next.ok) throw new Halt(422, "validation", next.error);
    if (action === "approve") {
      const plan = await applyApproval(c, a, id, locked, next.request, note, ctx);
      return { request: { ...next.request, status: "approved" as const }, notices: noticesFor("approved", noticeInput(ctx, next.request, managers)), warnings: plan.warnings, hours: plan.hours };
    }
    const terminal = next.request.status === "declined" || next.request.status === "rejected" || next.request.status === "cancelled";
    await c.query(
      `update shift_swap set status=$2, claimer_id=$3, manager_note=case when $4 then $5 else manager_note end, decided_by=case when $4 then $6 else decided_by end, decided_at=case when $4 then now() else decided_at end where id=$1`,
      [id, next.request.status, next.request.claimerId, terminal || action === "reject", note || null, a.userId],
    );
    await insertEvent(c, id, locked.status, next.request.status, action, note, a.userId, {});
    await audit(c, a, "shift_swap", id, action, { from: locked.status, to: next.request.status, reason: note });
    const event = { accept: "accepted", decline: "declined", claim: "claimed", cancel: "cancelled", reject: "rejected", approve: "approved" } as const;
    return { request: next.request, notices: noticesFor(event[action], noticeInput(ctx, next.request, managers)), warnings: [] as Violation[], hours: [] as HoursEffect[] };
  });
  await deliver(a, withManagers(outcome.notices, managers), id);
  const row = await readSwap(a.propertyId, id);
  const live = row?.status === "pending" || row?.status === "accepted";
  return row ? { ...present(row, ctx, live), warnings: outcome.warnings, hours: outcome.hours } : { id };
}
