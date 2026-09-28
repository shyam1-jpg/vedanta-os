/**
 * Auto rota from guest numbers. Staffing bands and personal rules are stored, not hard-coded.
 */
import type { FastifyInstance } from "fastify";
import { pool, tx } from "./db.ts";
import { requireActor, allow, problem, type Actor } from "./auth.ts";
import {
  DEFAULT_HOUSE_RULES,
  generateRota,
  guestDays,
  resolvePerson,
  rotaToCsv,
  rosteredHours,
} from "../../../domains/staff/auto-rota.ts";
import type { DepartmentStaffing, HouseRules, PlannedShift, RotaPerson } from "../../../domains/staff/auto-rota.ts";
import { addDaysIso, weekStartMonday } from "../../../domains/staff/payroll.ts";
import { CONSTRAINT_TEMPLATES, DEFAULT_STAFFING, ROLE_DEFAULTS } from "../../../domains/staff/staffing-defaults.ts";

function hm(value: unknown): string {
  return String(value ?? "").slice(0, 5);
}

async function editor(req: any, reply: any): Promise<Actor | null> {
  const a = await requireActor(req, reply);
  if (!a || !allow(a, "clock.manage", reply)) return null;
  return a;
}

async function reader(req: any, reply: any): Promise<Actor | null> {
  const a = await requireActor(req, reply);
  if (!a) return null;
  if (!a.perms.has("cover.read") && !a.perms.has("clock.manage")) {
    reply.code(403).send(problem(403, "forbidden", "You cannot open the rota"));
    return null;
  }
  return a;
}

export async function ensureStaffing(propertyId: string, tenantId: string) {
  const existing = await pool.query(`select count(*)::int n from staffing_band where property_id=$1`, [propertyId]);
  if (existing.rows[0].n === 0) {
    await tx(async c => {
      let sort = 0;
      for (const dept of DEFAULT_STAFFING) {
        for (const band of dept.bands) {
          const row = (await c.query(
            `insert into staffing_band (tenant_id, property_id, department_code, label, min_guests, max_guests, placeholder, note, sort_order)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
            [tenantId, propertyId, dept.department, band.label, band.minGuests, band.maxGuests, dept.placeholder, dept.note ?? null, sort++],
          )).rows[0];
          let shiftSort = 0;
          for (const shift of band.shifts) {
            await c.query(
              `insert into staffing_shift (band_id, code, label, start_time, end_time, break_minutes, headcount, role_codes, is_kp, is_opener, note, sort_order)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
              [row.id, shift.code, shift.label, shift.start, shift.end, shift.breakMinutes ?? 30, shift.count, shift.roleCodes, shift.kp, shift.opener, shift.note ?? null, shiftSort++],
            );
          }
        }
      }
    });
  }
  await pool.query(
    `insert into rota_house_rule (property_id, tenant_id, normal_week_hours, hours_include_break, late_finish, blocked_next_start, default_break_minutes, max_consecutive_days, max_days_per_week)
     values ($1,$2,40,true,'21:00','07:00',30,6,5) on conflict (property_id) do nothing`,
    [propertyId, tenantId],
  );
  for (const role of ROLE_DEFAULTS) {
    await pool.query(
      `insert into rota_role_default (property_id, role_code, never_kp, can_do_kp, opens_kitchen) values ($1,$2,$3,$4,$5)
       on conflict (property_id, role_code) do nothing`,
      [propertyId, role.role, role.neverKp, role.canDoKp, role.opensKitchen],
    );
  }
  for (const template of CONSTRAINT_TEMPLATES) {
    await pool.query(
      `insert into rota_constraint_template (code, label, detail, body) values ($1,$2,$3,$4::jsonb)
       on conflict (code) do update set label=excluded.label, detail=excluded.detail, body=excluded.body`,
      [template.code, template.label, template.detail, JSON.stringify(template.body)],
    );
  }
}

async function loadRules(propertyId: string): Promise<{ rules: DepartmentStaffing[]; house: HouseRules }> {
  const houseRow = (await pool.query(`select * from rota_house_rule where property_id=$1`, [propertyId])).rows[0];
  const house: HouseRules = houseRow ? {
    normalWeekHours: Number(houseRow.normal_week_hours),
    hoursIncludeBreak: houseRow.hours_include_break,
    lateFinish: hm(houseRow.late_finish),
    blockedNextStart: hm(houseRow.blocked_next_start),
    defaultBreakMinutes: houseRow.default_break_minutes,
    maxConsecutiveDays: houseRow.max_consecutive_days,
    maxDaysPerWeek: houseRow.max_days_per_week,
  } : DEFAULT_HOUSE_RULES;
  const bands = (await pool.query(
    `select id, department_code, label, min_guests, max_guests, placeholder, note, sort_order
     from staffing_band where property_id=$1 order by sort_order, min_guests`,
    [propertyId],
  )).rows;
  const shifts = bands.length
    ? (await pool.query(
      `select band_id, code, label, start_time::text, end_time::text, break_minutes, headcount, role_codes, is_kp, is_opener, note, sort_order
       from staffing_shift where band_id = any($1::uuid[]) order by sort_order`,
      [bands.map((b: { id: string }) => b.id)],
    )).rows
    : [];
  const byDept = new Map<string, DepartmentStaffing>();
  for (const band of bands) {
    const dept = byDept.get(band.department_code) ?? {
      department: band.department_code,
      placeholder: band.placeholder,
      note: band.note ?? undefined,
      bands: [] as DepartmentStaffing["bands"],
    };
    dept.bands.push({
      label: band.label,
      minGuests: band.min_guests,
      maxGuests: band.max_guests,
      shifts: shifts.filter((s: { band_id: string }) => s.band_id === band.id).map((s: any) => ({
        code: s.code,
        label: s.label,
        start: hm(s.start_time),
        end: hm(s.end_time),
        breakMinutes: s.break_minutes,
        count: s.headcount,
        roleCodes: s.role_codes ?? [],
        kp: s.is_kp,
        opener: s.is_opener,
        note: s.note ?? undefined,
      })),
    });
    byDept.set(band.department_code, dept);
  }
  return { rules: [...byDept.values()], house };
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function loadPeople(propertyId: string, from: string, to: string, house: HouseRules): Promise<RotaPerson[]> {
  const users = (await pool.query(
    `select distinct on (u.id) u.id, u.display_name as name, r.code as role, d.code as department,
        c.earliest_start::text, c.lates_only, c.lates_from::text, c.never_kp, c.can_do_kp, c.opens_kitchen,
        c.max_hours_week, c.max_hours_month, c.normal_week_hours, c.max_days_week, c.unavailable_weekdays, c.earliest_by_weekday,
        rd.never_kp as role_never_kp, rd.can_do_kp as role_can_do_kp, rd.opens_kitchen as role_opens
     from app_user u
     join membership m on m.user_id=u.id and m.property_id=$1
     join role r on r.id=m.role_id
     left join department d on d.id=m.department_id
     left join staff_rota_constraint c on c.user_id=u.id
     left join rota_role_default rd on rd.property_id=$1 and rd.role_code=r.code
     where u.status='ACTIVE'
     order by u.id, u.display_name`,
    [propertyId],
  )).rows;
  const history = (await pool.query(
    `select user_id, shift_date::text, start_time::text, end_time::text, break_minutes
     from rota_shift where property_id=$1 and status <> 'cancelled' and user_id is not null
       and not (shift_date >= $2::date and shift_date <= $3::date)
       and shift_date >= $2::date - 40 and shift_date <= $3::date + 7`,
    [propertyId, from, to],
  )).rows;
  const absences = (await pool.query(
    `select user_id, from_date::text, to_date::text from absence_request
     where property_id=$1 and status='approved' and to_date >= $2::date and from_date <= $3::date`,
    [propertyId, from, to],
  )).rows;
  return users.filter((u: { department: string | null }) => u.department).map((u: any) => {
    const monthHoursAlready: Record<string, number> = {};
    const weekHoursAlready: Record<string, number> = {};
    const workedDates: string[] = [];
    let previousShift: { date: string; end: string } | null = null;
    const dayBefore = addDaysIso(from, -1);
    for (const row of history.filter((h: { user_id: string }) => h.user_id === u.id)) {
      const hours = rosteredHours(hm(row.start_time), hm(row.end_time), row.break_minutes ?? house.defaultBreakMinutes, house.hoursIncludeBreak);
      const month = row.shift_date.slice(0, 7);
      const week = weekStartMonday(row.shift_date);
      monthHoursAlready[month] = Math.round(((monthHoursAlready[month] ?? 0) + hours) * 100) / 100;
      weekHoursAlready[week] = Math.round(((weekHoursAlready[week] ?? 0) + hours) * 100) / 100;
      workedDates.push(row.shift_date);
      if (row.shift_date === dayBefore) previousShift = { date: row.shift_date, end: hm(row.end_time) };
    }
    const unavailableDates: string[] = [];
    for (const leave of absences.filter((a: { user_id: string }) => a.user_id === u.id)) {
      for (let date = leave.from_date; date <= leave.to_date; date = addDaysIso(date, 1)) unavailableDates.push(date);
    }
    const weekday = u.earliest_by_weekday && typeof u.earliest_by_weekday === "object" ? u.earliest_by_weekday : {};
    return resolvePerson({
      userId: u.id,
      name: u.name,
      role: u.role,
      department: u.department,
      roleDefault: {
        neverKp: u.role_never_kp ?? undefined,
        canDoKp: u.role_can_do_kp ?? undefined,
        opensKitchen: u.role_opens ?? undefined,
      },
      saved: {
        earliestStart: u.earliest_start ? hm(u.earliest_start) : null,
        earliestByWeekday: Object.fromEntries(Object.entries(weekday).map(([k, v]) => [k, hm(v)])),
        latesOnly: !!u.lates_only,
        latesFrom: u.lates_from ? hm(u.lates_from) : "12:00",
        neverKp: u.never_kp,
        canDoKp: u.can_do_kp,
        opensKitchen: u.opens_kitchen,
        maxHoursWeek: num(u.max_hours_week),
        maxHoursMonth: num(u.max_hours_month),
        normalWeekHours: num(u.normal_week_hours),
        maxDaysWeek: u.max_days_week,
        unavailableWeekdays: u.unavailable_weekdays ?? [],
        unavailableDates,
      },
      house,
      monthHoursAlready,
      weekHoursAlready,
      workedDates,
      previousShift,
    });
  });
}

export default async function rotaRoutes(f: FastifyInstance) {
  f.get("/v1/rota/setup", async (req, reply) => {
    const a = await reader(req, reply); if (!a) return;
    await ensureStaffing(a.propertyId, a.tenantId);
    const { rules, house } = await loadRules(a.propertyId);
    const today = new Date().toISOString().slice(0, 10);
    const people = await loadPeople(a.propertyId, today, addDaysIso(today, 6), house);
    const templates = (await pool.query(`select code, label, detail from rota_constraint_template order by label`)).rows;
    const depts = (await pool.query(`select code, name from department where property_id=$1 order by sort_order, name`, [a.propertyId])).rows;
    return { rules, house, people, templates, departments: depts, can_edit: a.perms.has("clock.manage") };
  });

  f.put("/v1/rota/staffing", async (req: any, reply) => {
    const a = await editor(req, reply); if (!a) return;
    const departments = req.body?.departments as DepartmentStaffing[] | undefined;
    if (!Array.isArray(departments)) return reply.code(422).send(problem(422, "validation", "departments are required"));
    await tx(async c => {
      await c.query(`delete from staffing_band where property_id=$1`, [a.propertyId]);
      let sort = 0;
      for (const dept of departments) {
        if (!dept?.department) continue;
        for (const band of dept.bands ?? []) {
          const row = (await c.query(
            `insert into staffing_band (tenant_id, property_id, department_code, label, min_guests, max_guests, placeholder, note, sort_order)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
            [a.tenantId, a.propertyId, dept.department, band.label || `${band.minGuests}`, Number(band.minGuests), band.maxGuests == null || band.maxGuests === ("" as any) ? null : Number(band.maxGuests), !!dept.placeholder, dept.note ?? null, sort++],
          )).rows[0];
          let shiftSort = 0;
          for (const shift of band.shifts ?? []) {
            if (!shift.start || !shift.end) continue;
            await c.query(
              `insert into staffing_shift (band_id, code, label, start_time, end_time, break_minutes, headcount, role_codes, is_kp, is_opener, note, sort_order)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
              [row.id, shift.code || "SHIFT", shift.label || shift.code || "Shift", shift.start, shift.end, shift.breakMinutes ?? 30, Number(shift.count ?? 1), shift.roleCodes ?? [], !!shift.kp, !!shift.opener, shift.note ?? null, shiftSort++],
            );
          }
        }
      }
      if (req.body?.house) {
        const h = req.body.house;
        await c.query(
          `insert into rota_house_rule (property_id, tenant_id, normal_week_hours, hours_include_break, late_finish, blocked_next_start, default_break_minutes, max_consecutive_days, max_days_per_week)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           on conflict (property_id) do update set normal_week_hours=excluded.normal_week_hours, hours_include_break=excluded.hours_include_break,
             late_finish=excluded.late_finish, blocked_next_start=excluded.blocked_next_start, default_break_minutes=excluded.default_break_minutes,
             max_consecutive_days=excluded.max_consecutive_days, max_days_per_week=excluded.max_days_per_week`,
          [a.propertyId, a.tenantId, h.normalWeekHours ?? 40, h.hoursIncludeBreak !== false, h.lateFinish ?? "21:00", h.blockedNextStart ?? "07:00", h.defaultBreakMinutes ?? 30, h.maxConsecutiveDays ?? 6, h.maxDaysPerWeek ?? 5],
        );
      }
    });
    return { ok: true };
  });

  f.put("/v1/rota/constraints/:userId", async (req: any, reply) => {
    const a = await editor(req, reply); if (!a) return;
    const b = req.body ?? {};
    const weekdays = Array.isArray(b.unavailableWeekdays) ? b.unavailableWeekdays.map(Number) : [];
    await pool.query(
      `insert into staff_rota_constraint (
         user_id, tenant_id, property_id, earliest_start, lates_only, lates_from, never_kp, can_do_kp, opens_kitchen,
         max_hours_week, max_hours_month, normal_week_hours, max_days_week, unavailable_weekdays, earliest_by_weekday, notes
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::int[],$15::jsonb,$16)
       on conflict (user_id) do update set
         earliest_start=excluded.earliest_start, lates_only=excluded.lates_only, lates_from=excluded.lates_from,
         never_kp=excluded.never_kp, can_do_kp=excluded.can_do_kp, opens_kitchen=excluded.opens_kitchen,
         max_hours_week=excluded.max_hours_week, max_hours_month=excluded.max_hours_month,
         normal_week_hours=excluded.normal_week_hours, max_days_week=excluded.max_days_week,
         unavailable_weekdays=excluded.unavailable_weekdays, earliest_by_weekday=excluded.earliest_by_weekday,
         notes=excluded.notes, updated_at=now()`,
      [
        req.params.userId, a.tenantId, a.propertyId,
        b.earliestStart || null, !!b.latesOnly, b.latesFrom || "12:00",
        b.neverKp ?? null, b.canDoKp ?? null, b.opensKitchen ?? null,
        num(b.maxHoursWeek), num(b.maxHoursMonth), num(b.normalWeekHours), b.maxDaysWeek == null || b.maxDaysWeek === "" ? null : Number(b.maxDaysWeek),
        weekdays, JSON.stringify(b.earliestByWeekday ?? {}), b.notes ?? null,
      ],
    );
    return { ok: true };
  });

  f.post("/v1/rota/generate", async (req: any, reply) => {
    const a = await editor(req, reply); if (!a) return;
    const from = String(req.body?.from ?? "");
    const to = String(req.body?.to ?? from);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) {
      return reply.code(422).send(problem(422, "validation", "Give a from and to date"));
    }
    if (guestDays({ from, to }).length > 35) return reply.code(422).send(problem(422, "validation", "Generate at most five weeks at a time"));
    await ensureStaffing(a.propertyId, a.tenantId);
    const { rules, house } = await loadRules(a.propertyId);
    const people = await loadPeople(a.propertyId, from, to, house);
    const days = guestDays({ from, to, guests: req.body?.guests, days: req.body?.days });
    const result = generateRota({ days, rules, people, house });
    return { ...result, days, week_start: weekStartMonday(from) };
  });

  f.post("/v1/rota/draft", async (req: any, reply) => {
    const a = await editor(req, reply); if (!a) return;
    const shifts = (req.body?.shifts ?? []) as PlannedShift[];
    const weekStart = String(req.body?.week_start ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return reply.code(422).send(problem(422, "validation", "week_start is required"));
    const guestCounts = req.body?.guest_counts ?? {};
    const plan = await tx(async c => {
      const existing = (await c.query(`select id from rota_plan where property_id=$1 and week_start=$2`, [a.propertyId, weekStart])).rows[0];
      const planId = existing
        ? (await c.query(`update rota_plan set guest_counts=$3::jsonb, notes=$4, status='draft', updated_at=now() where id=$1 and property_id=$2 returning id`, [existing.id, a.propertyId, JSON.stringify(guestCounts), req.body?.notes ?? null])).rows[0].id
        : (await c.query(`insert into rota_plan (tenant_id, property_id, week_start, status, guest_counts, notes, created_by) values ($1,$2,$3,'draft',$4::jsonb,$5,$6) returning id`, [a.tenantId, a.propertyId, weekStart, JSON.stringify(guestCounts), req.body?.notes ?? null, a.userId])).rows[0].id;
      await c.query(`delete from rota_shift where plan_id=$1`, [planId]);
      for (const shift of shifts) {
        if (!shift?.date || !shift.start || !shift.end || !shift.department) continue;
        await c.query(
          `insert into rota_shift (tenant_id, property_id, user_id, department, role_code, shift_date, start_time, end_time, break_minutes, status, notes, created_by, plan_id, shift_code, label, gap, gap_reason, lieu_hours, placeholder)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'scheduled',$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [
            a.tenantId, a.propertyId, shift.userId || null, shift.department, shift.role, shift.date, shift.start, shift.end,
            shift.breakMinutes ?? 30, shift.note ?? null, a.userId, planId, shift.code ?? null, shift.label ?? null,
            !shift.userId, shift.userId ? null : (shift.gapReason || "GAP"), shift.lieuHours ?? 0, !!shift.placeholder,
          ],
        );
      }
      return planId;
    });
    return { id: plan, status: "draft" };
  });

  f.get("/v1/rota/plan", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const from = String(req.query?.from ?? "");
    const to = String(req.query?.to ?? from);
    const department = String(req.query?.department ?? "");
    const r = await pool.query(
      `select rs.id, rs.shift_date::text as date, rs.department, rs.shift_code as code, coalesce(rs.label, rs.shift_code, 'Shift') as label,
              rs.start_time::text as start, rs.end_time::text as end, rs.break_minutes, rs.gap, rs.gap_reason, rs.lieu_hours, rs.placeholder, rs.notes,
              rs.user_id, u.display_name as name, rs.role_code as role, p.week_start::text, p.guest_counts, p.status as plan_status
       from rota_shift rs
       left join app_user u on u.id = rs.user_id
       left join rota_plan p on p.id = rs.plan_id
       where rs.property_id=$1
         and ($2 = '' or rs.shift_date >= $2::date)
         and ($3 = '' or rs.shift_date <= $3::date)
         and ($4 = '' or rs.department = $4)
         and rs.status <> 'cancelled'
       order by rs.shift_date, rs.department, rs.start_time`,
      [a.propertyId, from, to, department],
    );
    return {
      items: r.rows.map((row: any) => ({
        ...row,
        start: hm(row.start),
        end: hm(row.end),
        hours: rosteredHours(hm(row.start), hm(row.end), row.break_minutes ?? 30, true),
        gap: row.gap || !row.user_id,
        lieuHours: Number(row.lieu_hours ?? 0),
        userId: row.user_id,
        gapReason: row.gap_reason,
      })),
    };
  });

  f.get("/v1/rota/plan.csv", async (req: any, reply) => {
    const a = await reader(req, reply); if (!a) return;
    const from = String(req.query?.from ?? "");
    const to = String(req.query?.to ?? from);
    const r = await pool.query(
      `select rs.shift_date::text as date, rs.department, coalesce(rs.label, rs.shift_code, 'Shift') as label,
              rs.start_time::text as start, rs.end_time::text as end, rs.break_minutes, rs.gap, rs.gap_reason, rs.lieu_hours, rs.placeholder,
              rs.user_id, u.display_name as name, rs.role_code as role, rs.shift_code as code, rs.notes
       from rota_shift rs left join app_user u on u.id=rs.user_id
       where rs.property_id=$1 and ($2='' or rs.shift_date >= $2::date) and ($3='' or rs.shift_date <= $3::date) and rs.status <> 'cancelled'
       order by rs.shift_date, rs.department, rs.start_time`,
      [a.propertyId, from, to],
    );
    const shifts: PlannedShift[] = r.rows.map((row: any) => ({
      date: row.date, department: row.department, code: row.code ?? "", label: row.label, start: hm(row.start), end: hm(row.end),
      breakMinutes: row.break_minutes ?? 30, hours: rosteredHours(hm(row.start), hm(row.end), row.break_minutes ?? 30, true),
      userId: row.user_id, name: row.name, role: row.role, gap: row.gap || !row.user_id, gapReason: row.gap_reason,
      lieuHours: Number(row.lieu_hours ?? 0), placeholder: row.placeholder, note: row.notes,
    }));
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="rota-${from || "draft"}.csv"`);
    return rotaToCsv(shifts);
  });

  f.patch("/v1/rota/shifts/:id", async (req: any, reply) => {
    const a = await editor(req, reply); if (!a) return;
    const b = req.body ?? {};
    const userId = b.user_id === "" ? null : (b.user_id ?? undefined);
    const current = (await pool.query(`select id, user_id from rota_shift where id=$1 and property_id=$2`, [req.params.id, a.propertyId])).rows[0];
    if (!current) return reply.code(404).send(problem(404, "not_found", "No such shift"));
    const nextUser = userId === undefined ? current.user_id : userId;
    await pool.query(
      `update rota_shift set user_id=$3, start_time=coalesce($4, start_time), end_time=coalesce($5, end_time), notes=coalesce($6, notes),
         gap=$7, gap_reason=$8, role_code=coalesce($9, role_code)
       where id=$1 and property_id=$2`,
      [req.params.id, a.propertyId, nextUser, b.start_time ?? null, b.end_time ?? null, b.notes ?? null, !nextUser, nextUser ? null : "Left open by hand", b.role ?? null],
    );
    return { ok: true };
  });
}
