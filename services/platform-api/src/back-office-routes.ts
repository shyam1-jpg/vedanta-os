/**
 * Staff-entered house money. Reads bookings and clock punches the house already has.
 * Does not call a shop, send a message, or invent a guest, a rate, or a budget.
 */
import type { FastifyInstance } from "fastify";
import { pool } from "./db.ts";
import { requireActor, allow, problem, type Actor } from "./auth.ts";
import {
  HOUSE_DEPARTMENTS,
  buildMoneyView,
  deliveryScores,
  departmentName,
  enteredOrBlank,
  foodBillBreaksHouse,
  isExpenseDepartment,
  isHouseDepartment,
  labourFromPunches,
  requiredFor,
  resolveSupplier,
  retreatIncomeNote,
  type ExpenseKind,
  type LabourPerson,
  type MonthBudget,
  type Period,
  type Stay,
} from "../../../domains/finance/back-office.ts";
import type { Punch } from "../../../domains/staff/hours.ts";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NOTE = "Guests do not pay for food. The restaurant is buffet only. A bill, a wage and a float are each counted once.";

function pounds(value: unknown, allowZero = false): number | null {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(n) || n > 1_000_000 || (allowZero ? n < 0 : n <= 0)) return null;
  return Math.round(n * 100) / 100;
}

function whole(value: unknown, min = 0): number | null {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isInteger(n) || n < min || n > 10000) return null;
  return n;
}

function scoreField(value: unknown): number | null | "bad" {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 5) return "bad";
  return n;
}

function isGm(a: Actor): boolean {
  return a.role === "GENERAL_MANAGER" || a.role === "SYSTEM_OWNER";
}

async function londonToday(): Promise<string> {
  const r = await pool.query(`select (timezone('Europe/London', now()))::date::text t`);
  return r.rows[0].t as string;
}

export default async function backOfficeRoutes(f: FastifyInstance) {
  f.get("/v1/finance/house", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "report.read", reply)) return;
    const today = await londonToday();
    const period = (["day", "week", "month"].includes(req.query?.period) ? req.query.period : "day") as Period;
    const anchor = DATE.test(req.query?.anchor ?? "") ? req.query.anchor : today;
    const viewRange = buildMoneyView({ anchor, period, income: [], expenses: [], labour: [], stays: [], budgets: [] });
    const { from, to } = viewRange;

    const [incomeR, billR, pettyR, budgetR, stayR, peopleR, punchR, signerR] = await Promise.all([
      pool.query(`select id, received_on::text date, amount, note from retreat_income where property_id=$1 and received_on between $2 and $3 order by received_on, created_at`, [a.propertyId, from, to]),
      pool.query(`select id, spent_on::text date, amount, department, kind from supplier_bill where property_id=$1 and spent_on between $2 and $3`, [a.propertyId, from, to]),
      pool.query(`select p.id, p.on_date::text date, p.amount, p.note, u.display_name signed_out_by
        from petty_cash p join app_user u on u.id=p.signed_out_by
        where p.property_id=$1 and p.on_date between $2 and $3 order by p.on_date, p.created_at`, [a.propertyId, from, to]),
      pool.query(`select year, month, category department, amount from budget where property_id=$1 and category = any($2::text[])`, [a.propertyId, HOUSE_DEPARTMENTS.map(d => d.code)]),
      pool.query(`select arrival_date::text arrival, departure_date::text departure, expected_guests, status
        from booking_group where property_id=$1 and status in ('CONFIRMED','IN_HOUSE','COMPLETED')
          and departure_date >= $2 and arrival_date <= $3`, [a.propertyId, from, to]),
      pool.query(`select u.id, r.code role, d.code department, h.hourly_rate
        from app_user u join membership m on m.user_id=u.id join role r on r.id=m.role_id
        left join department d on d.id=m.department_id
        left join staff_hr h on h.user_id=u.id
        where m.property_id=$1 and u.status='ACTIVE'`, [a.propertyId]),
      pool.query(`select user_id, kind, at from staff_clock
        where property_id=$1 and at >= ($2::date - interval '1 day') and at < ($3::date + interval '2 days')`, [a.propertyId, from, to]),
      pool.query(`select u.id, u.display_name name from app_user u join membership m on m.user_id=u.id
        where m.property_id=$1 and u.status='ACTIVE' order by u.display_name`, [a.propertyId]),
    ]);

    const income = incomeR.rows.map((r: { date: string; amount: string }) => ({ date: r.date, amount: Number(r.amount) }));
    const expenses = billR.rows.map((r: { date: string; amount: string; department: string; kind: ExpenseKind }) => ({
      date: r.date, amount: Number(r.amount), department: r.department, kind: r.kind,
    }));
    const petty = pettyR.rows.map((r: { date: string; amount: string }) => ({ date: r.date, amount: Number(r.amount) }));
    const budgets: MonthBudget[] = budgetR.rows.map((r: { year: number; month: number; department: string; amount: string }) => ({
      year: r.year, month: r.month, department: r.department, amount: Number(r.amount),
    }));
    const unknownGuests = stayR.rows.some((r: { expected_guests: number | null }) => r.expected_guests == null);
    const stays: Stay[] = stayR.rows
      .filter((r: { expected_guests: number | null }) => r.expected_guests != null)
      .map((r: { arrival: string; departure: string; expected_guests: number; status: string }) => ({
        arrival: r.arrival, departure: r.departure, guests: Number(r.expected_guests), status: r.status,
      }));
    const people: LabourPerson[] = peopleR.rows.map((r: { id: string; role: string; department: string | null; hourly_rate: string | null }) => ({
      userId: r.id, role: r.role, department: r.department, hourlyRate: r.hourly_rate == null ? null : Number(r.hourly_rate),
    }));
    const punches = punchR.rows.map((r: { user_id: string; kind: "IN" | "OUT"; at: Date }) => ({
      userId: r.user_id, kind: r.kind, at: new Date(r.at),
    })) as (Punch & { userId: string })[];
    const labour = labourFromPunches(people, punches);
    const view = buildMoneyView({ anchor, period, income, expenses, labour, stays, budgets, petty });
    const rated = labour.some(l => l.date >= from && l.date <= to && l.cost != null);
    const moneyIn = enteredOrBlank(income.length > 0, view.moneyIn);
    const supplierSpend = enteredOrBlank(expenses.length > 0, view.supplierSpend);
    const labourCost = enteredOrBlank(rated, view.labourCost);
    const pettySpent = enteredOrBlank(petty.length > 0, view.pettySpent);
    const moneyOutEntered = supplierSpend != null || labourCost != null || pettySpent != null;
    const moneyOut = moneyOutEntered ? view.moneyOut : null;
    const bothSides = moneyIn != null && moneyOut != null;

    const billDepts = new Set(expenses.map(e => e.department));
    const labourDepts = new Set(labour.filter(l => l.date >= from && l.date <= to && l.cost != null).map(l => l.department));
    const departments = HOUSE_DEPARTMENTS.map(d => {
      const row = view.departments.find(x => x.code === d.code);
      const supplier = billDepts.has(d.code) ? (row?.supplier ?? 0) : null;
      const labourAmount = labourDepts.has(d.code) ? (row?.labour ?? 0) : null;
      const spend = supplier == null && labourAmount == null ? null : (supplier ?? 0) + (labourAmount ?? 0);
      const budget = budgets.some(b => b.department === d.code) ? (row?.budget ?? null) : null;
      return {
        code: d.code,
        name: d.name,
        supplier,
        labour: labourAmount,
        spend: spend == null ? null : Math.round(spend * 100) / 100,
        budget,
        variance: budget == null || spend == null ? null : Math.round((budget - spend) * 100) / 100,
      };
    });

    return {
      note: NOTE,
      today,
      anchor,
      period,
      from,
      to,
      canSetBudget: isGm(a),
      guestsKnown: !unknownGuests,
      guestsInHouse: unknownGuests ? null : view.guestsInHouse,
      guestNights: unknownGuests ? null : view.guestNights,
      peakGuests: unknownGuests ? null : view.peakGuests,
      moneyIn,
      moneyOut,
      supplierSpend,
      foodSpend: enteredOrBlank(expenses.some(e => e.kind === "food"), view.foodSpend),
      otherSpend: enteredOrBlank(expenses.some(e => e.kind === "other"), view.otherSpend),
      labourCost,
      pettySpent,
      unratedHours: view.unratedHours > 0 ? view.unratedHours : null,
      openShiftsCapped: view.openShiftsCapped,
      costPerGuest: moneyOut != null && !unknownGuests ? view.costPerGuest : null,
      profit: bothSides ? view.profit : null,
      breakEvenRevenue: moneyOut,
      shortOfBreakEven: bothSides ? view.shortOfBreakEven : null,
      aboveBreakEven: bothSides ? view.aboveBreakEven : null,
      breakEvenGuests: bothSides ? view.breakEvenGuests : null,
      departments,
      series: view.series.map(point => ({
        ...point,
        moneyIn: income.some(r => point.key.length === 7 ? r.date.startsWith(point.key) : r.date === point.key) ? point.moneyIn : null,
        moneyOut: (expenses.some(r => point.key.length === 7 ? r.date.startsWith(point.key) : r.date === point.key)
          || petty.some(r => point.key.length === 7 ? r.date.startsWith(point.key) : r.date === point.key)
          || labour.some(r => r.cost != null && (point.key.length === 7 ? r.date.startsWith(point.key) : r.date === point.key)))
          ? point.moneyOut : null,
      })),
      income: incomeR.rows.map((r: { id: string; date: string; amount: string; note: string | null }) => ({ id: r.id, date: r.date, amount: Number(r.amount), note: r.note })),
      petty: pettyR.rows.map((r: { id: string; date: string; amount: string; note: string | null; signed_out_by: string }) => ({
        id: r.id, date: r.date, amount: Number(r.amount), note: r.note, signedOutBy: r.signed_out_by,
      })),
      signers: signerR.rows,
    };
  });

  f.post("/v1/finance/income", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "report.read", reply)) return;
    const amount = pounds(req.body?.amount);
    const received_on = String(req.body?.received_on ?? "");
    const note = String(req.body?.note ?? "");
    if (!DATE.test(received_on) || amount == null) return reply.code(422).send(problem(422, "validation", "Enter a date and an amount."));
    const noteError = retreatIncomeNote(note);
    if (noteError) return reply.code(422).send(problem(422, "validation", noteError));
    let bookingId: string | null = req.body?.booking_id ?? null;
    if (bookingId) {
      const found = await pool.query(`select id from booking_group where id=$1 and property_id=$2`, [bookingId, a.propertyId]);
      if (!found.rowCount) return reply.code(404).send(problem(404, "not_found", "That retreat is not on the board."));
    } else bookingId = null;
    const r = await pool.query(`insert into retreat_income (tenant_id, property_id, received_on, amount, note, booking_id, entered_by)
      values ($1,$2,$3,$4,$5,$6,$7) returning id`, [a.tenantId, a.propertyId, received_on, amount, note.trim() || null, bookingId, a.userId]);
    return { id: r.rows[0].id };
  });

  f.post("/v1/finance/petty", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "report.read", reply)) return;
    const amount = pounds(req.body?.amount);
    const on_date = String(req.body?.on_date ?? "");
    const signed_out_by = String(req.body?.signed_out_by ?? "");
    const note = String(req.body?.note ?? "").trim();
    if (!DATE.test(on_date) || amount == null || !signed_out_by) return reply.code(422).send(problem(422, "validation", "Enter the date, the amount signed out, and who signed it out."));
    const person = await pool.query(`select u.id from app_user u join membership m on m.user_id=u.id where u.id=$1 and m.property_id=$2 and u.status='ACTIVE'`, [signed_out_by, a.propertyId]);
    if (!person.rowCount) return reply.code(422).send(problem(422, "validation", "Choose a member of staff who signed the float out."));
    const r = await pool.query(`insert into petty_cash (tenant_id, property_id, on_date, amount, signed_out_by, note, entered_by)
      values ($1,$2,$3,$4,$5,$6,$7) returning id`, [a.tenantId, a.propertyId, on_date, amount, signed_out_by, note || null, a.userId]);
    return { id: r.rows[0].id };
  });

  f.post("/v1/finance/department-budget", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "report.read", reply)) return;
    if (!isGm(a)) return reply.code(403).send(problem(403, "forbidden", "The general manager sets department budgets."));
    const year = whole(req.body?.year, 2000);
    const month = whole(req.body?.month, 1);
    const department = String(req.body?.department ?? "");
    if (year == null || year > 2100 || month == null || month > 12 || !isHouseDepartment(department)) {
      return reply.code(422).send(problem(422, "validation", "Choose a department, a month, and a year."));
    }
    if (req.body?.amount == null || req.body?.amount === "") {
      await pool.query(`delete from budget where property_id=$1 and year=$2 and month=$3 and category=$4`, [a.propertyId, year, month, department]);
      return { ok: true, amount: null };
    }
    const amount = pounds(req.body.amount, true);
    if (amount == null) return reply.code(422).send(problem(422, "validation", "Enter the budget amount, or leave it blank."));
    await pool.query(`insert into budget (tenant_id, property_id, year, month, category, amount, created_by)
      values ($1,$2,$3,$4,$5,$6,$7)
      on conflict (property_id, year, month, category) do update set amount=excluded.amount`,
      [a.tenantId, a.propertyId, year, month, department, amount, a.userId]);
    return { ok: true, amount };
  });

  f.get("/v1/supplier-bills", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a) return;
    if (!a.perms.has("group.read") && !a.perms.has("report.read")) return reply.code(403).send(problem(403, "forbidden", "You cannot read supplier bills."));
    const rows = await pool.query(`select id, spent_on::text date, supplier_code, supplier_name, local_shop, kind, department, amount, note,
        delivered_at, quality, price_score, reliability
      from supplier_bill where property_id=$1 order by spent_on desc, created_at desc limit 100`, [a.propertyId]);
    const local = await pool.query(`select distinct supplier_name from supplier_bill where property_id=$1 and local_shop order by supplier_name`, [a.propertyId]);
    return {
      items: rows.rows.map((r: any) => ({ ...r, amount: Number(r.amount), department_name: departmentName(r.department) })),
      localShops: local.rows.map((r: { supplier_name: string }) => r.supplier_name),
    };
  });

  f.post("/v1/supplier-bills", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a) return;
    if (!a.perms.has("group.read") && !a.perms.has("report.read")) return reply.code(403).send(problem(403, "forbidden", "You cannot log a supplier bill."));
    const spent_on = String(req.body?.spent_on ?? "");
    const kind = req.body?.kind === "food" || req.body?.kind === "other" ? req.body.kind as ExpenseKind : null;
    const department = String(req.body?.department ?? "");
    const amount = pounds(req.body?.amount);
    const note = String(req.body?.note ?? "").trim();
    if (!DATE.test(spent_on) || !kind || !isExpenseDepartment(department) || amount == null) {
      return reply.code(422).send(problem(422, "validation", "Enter the date, shop, food or other, department, and amount."));
    }
    if (kind === "food" && note) {
      const broken = foodBillBreaksHouse(note);
      if (broken) return reply.code(422).send(problem(422, "validation", `The house does not buy ${broken}. Vegetarian, no eggs, no onion family, and the cows are not milked.`));
    }
    const shop = resolveSupplier({ code: req.body?.supplier_code, localName: req.body?.local_name });
    if (!shop.ok) return reply.code(422).send(problem(422, "validation", shop.error));
    const r = await pool.query(`insert into supplier_bill (tenant_id, property_id, spent_on, supplier_code, supplier_name, local_shop, kind, department, amount, note, entered_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [a.tenantId, a.propertyId, spent_on, shop.code, shop.name, shop.local, kind, department, amount, note || null, a.userId]);
    return { id: r.rows[0].id };
  });

  f.post("/v1/supplier-bills/:id/deliver", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a) return;
    if (!a.perms.has("group.read") && !a.perms.has("report.read")) return reply.code(403).send(problem(403, "forbidden", "You cannot mark a delivery."));
    const r = await pool.query(`update supplier_bill set delivered_at=coalesce(delivered_at, now()) where id=$1 and property_id=$2 returning id, delivered_at`, [req.params.id, a.propertyId]);
    if (!r.rowCount) return reply.code(404).send(problem(404, "not_found", "No such bill."));
    return { id: r.rows[0].id, delivered_at: r.rows[0].delivered_at };
  });

  f.post("/v1/supplier-bills/:id/scores", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a) return;
    if (!a.perms.has("group.read") && !a.perms.has("report.read")) return reply.code(403).send(problem(403, "forbidden", "You cannot score a delivery."));
    const quality = scoreField(req.body?.quality);
    const price = scoreField(req.body?.price);
    const reliability = scoreField(req.body?.reliability);
    if (quality === "bad" || price === "bad" || reliability === "bad") return reply.code(422).send(problem(422, "validation", "A score is from 1 to 5, or left blank."));
    const bill = (await pool.query(`select delivered_at from supplier_bill where id=$1 and property_id=$2`, [req.params.id, a.propertyId])).rows[0];
    if (!bill) return reply.code(404).send(problem(404, "not_found", "No such bill."));
    const scored = deliveryScores({ delivered: !!bill.delivered_at, quality, price, reliability });
    if (!scored.ok) return reply.code(422).send(problem(422, "validation", scored.error));
    await pool.query(`update supplier_bill set quality=$3, price_score=$4, reliability=$5 where id=$1 and property_id=$2`, [req.params.id, a.propertyId, scored.quality, scored.price, scored.reliability]);
    return { ok: true };
  });

  f.get("/v1/labour/staffing", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "clock.manage", reply)) return;
    const today = await londonToday();
    const stays = await pool.query(`select expected_guests from booking_group
      where property_id=$1 and status in ('CONFIRMED','IN_HOUSE','COMPLETED') and arrival_date <= $2 and departure_date > $2`, [a.propertyId, today]);
    const unknown = stays.rows.some((r: { expected_guests: number | null }) => r.expected_guests == null);
    const guests = unknown ? null : stays.rows.reduce((n: number, r: { expected_guests: number }) => n + Number(r.expected_guests), 0);
    const plans = (await pool.query(`select guest_count, department, required from staffing_plan where property_id=$1 order by guest_count, department`, [a.propertyId])).rows
      .map((r: { guest_count: number; department: string; required: number }) => ({ guestCount: r.guest_count, department: r.department, required: r.required }));
    const lines = HOUSE_DEPARTMENTS.map(d => {
      const rule = guests == null ? { planFor: null, required: null } : requiredFor(plans, guests, d.code);
      return { code: d.code, name: d.name, planFor: rule.planFor, required: rule.required };
    });
    return { today, guests, guestsKnown: !unknown, canSave: a.perms.has("clock.manage") || isGm(a), plans, lines };
  });

  f.post("/v1/labour/staffing", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "clock.manage", reply)) return;
    const guestCount = whole(req.body?.guest_count, 0);
    const required = whole(req.body?.required, 0);
    const department = String(req.body?.department ?? "");
    if (guestCount == null || required == null || !isHouseDepartment(department)) {
      return reply.code(422).send(problem(422, "validation", "Enter the guest count, the department, and how many people are required."));
    }
    await pool.query(`insert into staffing_plan (tenant_id, property_id, guest_count, department, required, saved_by)
      values ($1,$2,$3,$4,$5,$6)
      on conflict (property_id, guest_count, department) do update set required=excluded.required, saved_by=excluded.saved_by, updated_at=now()`,
      [a.tenantId, a.propertyId, guestCount, department, required, a.userId]);
    return { ok: true };
  });
}
