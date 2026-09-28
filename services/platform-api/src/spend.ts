/** Department budgets and the expenses logged against them. Budgets need spend.manage. */
import type { FastifyInstance } from "fastify";
import { pool, tx, type Q } from "./db.ts";
import { requireActor, allow, problem, type Actor } from "./auth.ts";
import { audit } from "./groups.ts";
import { sendEmail } from "./email.ts";
import { cleanPhoto } from "../../../domains/ops/fault.ts";
import {
  alertText,
  canCheckSpend,
  canLogSpend,
  canSetBudget,
  categoryAllowed,
  colourBand,
  copyBudgets,
  daysInMonth,
  formatGbp,
  londonDay,
  mayEditSpend,
  monthLabel,
  monthOfDate,
  monthStart,
  paceIndicator,
  paceLabel,
  parsePoundsToPence,
  parseSpendSettings,
  reportLines,
  shiftMonth,
  spendCsv,
  spendPdf,
  spendScope,
  thresholdsToSend,
  validDate,
  validMonth,
  type SpendSettings,
  type SpendViewer,
  type Threshold,
} from "../../../domains/ops/spend.ts";

async function londonToday(): Promise<string> {
  const row = (await pool.query(`select to_char(timezone('Europe/London', now()), 'YYYY-MM-DD') as date`)).rows[0];
  return String(row.date);
}

async function loadSettings(propertyId: string): Promise<SpendSettings> {
  const row = (await pool.query(`select settings->'spend' spend from property where id=$1`, [propertyId])).rows[0];
  return parseSpendSettings(row?.spend);
}

async function headOf(propertyId: string, userId: string): Promise<string | null> {
  const row = (await pool.query(
    `select d.code from org_position p join department d on d.id = p.department_id
     where p.property_id=$1 and p.holder_id=$2 and p.level='head' and p.active limit 1`,
    [propertyId, userId],
  )).rows[0];
  return row?.code ?? null;
}

function viewer(a: Actor, head: string | null): SpendViewer {
  return { role: a.role, department: a.department, perms: a.perms, headOf: head && head === a.department ? head : null };
}

async function actor(req: any, reply: any): Promise<Actor | null> {
  const a = await requireActor(req, reply, ["ADMIN", "STAFF"]);
  if (!a || !allow(a, "spend.log", reply)) return null;
  return a;
}

type Dept = { id: string; code: string; name: string };

async function resolveDepartment(propertyId: string, raw: unknown): Promise<Dept | null> {
  const key = String(raw ?? "").trim();
  if (!key) return null;
  const row = (await pool.query(
    `select id, code, name from department where property_id=$1 and (id::text=$2 or code=$2) limit 1`,
    [propertyId, key],
  )).rows[0];
  return row ?? null;
}

function scopeFor(a: Actor, head: string | null) {
  return spendScope(viewer(a, head));
}

export async function dispatchSpendAlerts(propertyId: string, opts?: { departmentId?: string; month?: string }) {
  const today = await londonToday();
  const month = opts?.month && validMonth(opts.month) ? opts.month : monthOfDate(today);
  const start = monthStart(month);
  const settings = await loadSettings(propertyId);
  const property = (await pool.query(`select tenant_id from property where id=$1`, [propertyId])).rows[0];
  if (!property) return;
  const rows = (await pool.query(
    `select d.id, d.name,
            coalesce(b.amount_pence, 0)::int budget,
            coalesce((select sum(e.amount_pence)::int from spend_expense e
                      where e.department_id = d.id and e.deleted_at is null
                        and e.spent_on >= $2::date and e.spent_on < ($2::date + interval '1 month')), 0) spent
     from department d
     left join spend_budget b on b.department_id = d.id and b.property_id = d.property_id and b.month = $2::date
     where d.property_id=$1 and ($3::uuid is null or d.id=$3)`,
    [propertyId, start, opts?.departmentId ?? null],
  )).rows as { id: string; name: string; budget: number; spent: number }[];
  for (const row of rows) {
    const sent = (await pool.query(
      `select threshold from spend_alert where property_id=$1 and department_id=$2 and month=$3::date`,
      [propertyId, row.id, start],
    )).rows.map((item: { threshold: string }) => item.threshold);
    const due = thresholdsToSend(row.spent, row.budget, sent);
    if (!due.length) continue;
    const heads = settings.notify_heads
      ? (await pool.query(
        `select distinct u.email from org_position p join app_user u on u.id = p.holder_id
         where p.property_id=$1 and p.department_id=$2 and p.level='head' and p.active and u.email is not null`,
        [propertyId, row.id],
      )).rows.map((item: { email: string }) => item.email)
      : [];
    const recipients = [...new Set([...(settings.gm_email ? [settings.gm_email] : []), ...heads].map(email => email.trim().toLowerCase()).filter(Boolean))];
    if (!recipients.length) continue;
    for (const threshold of due) await sendThreshold(property.tenant_id, propertyId, row, month, start, threshold, recipients);
  }
}

async function sendThreshold(
  tenantId: string,
  propertyId: string,
  row: { id: string; name: string; budget: number; spent: number },
  month: string,
  start: string,
  threshold: Threshold,
  recipients: string[],
) {
  const inserted = (await pool.query(
    `insert into spend_alert (tenant_id, property_id, department_id, month, threshold)
     values ($1,$2,$3,$4::date,$5)
     on conflict (property_id, department_id, month, threshold) do nothing
     returning id`,
    [tenantId, propertyId, row.id, start, threshold],
  )).rows[0];
  if (!inserted) return;
  const note = alertText({ department: row.name, spent: row.spent, budget: row.budget, month, threshold });
  for (const to of recipients) {
    await sendEmail(
      { tenantId, propertyId },
      { to, subject: note.subject, body: note.body, kind: "spend_alert", related_type: "spend_alert", related_id: inserted.id },
    );
  }
}

export async function remindSpend(propertyId: string) {
  await dispatchSpendAlerts(propertyId);
}

type ExpenseRow = {
  id: string; amount_pence: number; category: string; spent_on: string; description: string;
  review: string; review_note: string | null; reviewed_at: string | null; has_receipt: boolean;
  department_id: string; department: string; department_name: string;
  spent_by: string; spent_by_name: string; logged_by: string; logged_by_name: string;
  supplier_id: string | null; supplier_name: string | null;
  ticket_id: string | null; ticket_number: number | null; ticket_title: string | null;
  stock_log_id: string | null; stock_name: string | null;
};

function presentExpense(row: ExpenseRow, who: SpendViewer, userId: string) {
  return {
    id: row.id,
    amount_pence: row.amount_pence,
    amount: formatGbp(row.amount_pence),
    amount_input: (row.amount_pence / 100).toFixed(2),
    category: row.category,
    spent_on: row.spent_on,
    description: row.description,
    review: row.review,
    review_note: row.review_note,
    has_receipt: row.has_receipt,
    department: row.department,
    department_name: row.department_name,
    spent_by: row.spent_by,
    spent_by_name: row.spent_by_name,
    logged_by_name: row.logged_by_name,
    supplier_id: row.supplier_id,
    supplier_name: row.supplier_name,
    ticket_id: row.ticket_id,
    ticket_label: row.ticket_number ? `#${row.ticket_number} ${row.ticket_title ?? ""}`.trim() : null,
    stock_log_id: row.stock_log_id,
    stock_name: row.stock_name,
    may_edit: mayEditSpend(who, { department: row.department, loggedBy: row.logged_by, spentBy: row.spent_by }, userId),
    may_review: canCheckSpend(who, row.department),
  };
}

const EXPENSE_SQL = `select e.id, e.amount_pence, e.category, e.spent_on::text, e.description, e.review, e.review_note, e.reviewed_at,
  (e.receipt is not null) has_receipt, e.department_id, d.code department, d.name department_name,
  e.spent_by, su.display_name spent_by_name, e.logged_by, lu.display_name logged_by_name,
  e.supplier_id, s.name supplier_name, e.ticket_id, t.number ticket_number, t.title ticket_title,
  e.stock_log_id, i.name stock_name
  from spend_expense e
  join department d on d.id = e.department_id
  join app_user su on su.id = e.spent_by
  join app_user lu on lu.id = e.logged_by
  left join supplier s on s.id = e.supplier_id
  left join maintenance_ticket t on t.id = e.ticket_id
  left join kitchen_stock_log k on k.id = e.stock_log_id
  left join kitchen_stock_item i on i.id = k.item_id`;

async function cardsFor(propertyId: string, month: string, department: string | null, who: SpendViewer, day: number) {
  const start = monthStart(month);
  const days = daysInMonth(month);
  const rows = (await pool.query(
    `select d.id, d.code, d.name,
            coalesce(b.amount_pence, 0)::int budget,
            coalesce((select sum(e.amount_pence)::int from spend_expense e
                      where e.department_id = d.id and e.deleted_at is null
                        and e.spent_on >= $2::date and e.spent_on < ($2::date + interval '1 month')), 0) spent
     from department d
     left join spend_budget b on b.department_id = d.id and b.property_id = d.property_id and b.month = $2::date
     where d.property_id=$1 and ($3::text is null or d.code=$3)
     order by d.sort_order, d.name`,
    [propertyId, start, department],
  )).rows as { id: string; code: string; name: string; budget: number; spent: number }[];
  return rows.map(row => {
    const pace = paceIndicator(row.spent, row.budget, day, days);
    return {
      department_id: row.id,
      code: row.code,
      name: row.name,
      spent_pence: row.spent,
      budget_pence: row.budget,
      remaining_pence: row.budget - row.spent,
      spent: formatGbp(row.spent),
      budget: formatGbp(row.budget),
      remaining: formatGbp(row.budget - row.spent),
      colour: colourBand(row.spent, row.budget),
      pace: pace.pace,
      days_left: pace.daysLeft,
      pace_label: paceLabel(pace.pace, pace.daysLeft),
      can_check: canCheckSpend(who, row.code),
    };
  });
}

export default async function spendRoutes(f: FastifyInstance) {
  f.get("/v1/spend", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a) return;
    const today = await londonToday();
    const month = validMonth(String(req.query?.month ?? "")) ? String(req.query.month) : monthOfDate(today);
    const head = await headOf(a.propertyId, a.userId);
    const who = viewer(a, head);
    const scope = spendScope(who);
    const day = month === monthOfDate(today) ? londonDay(today) : daysInMonth(month);
    const cards = await cardsFor(a.propertyId, month, scope.all ? null : scope.department, who, day);
    const expenses = (await pool.query(
      `${EXPENSE_SQL}
       where e.property_id=$1 and e.deleted_at is null
         and e.spent_on >= $2::date and e.spent_on < ($2::date + interval '1 month')
         and ($3::text is null or d.code=$3)
       order by e.spent_on desc, e.created_at desc limit 200`,
      [a.propertyId, monthStart(month), scope.all ? null : scope.department],
    )).rows as ExpenseRow[];
    const people = (await pool.query(
      `select u.id, u.display_name name, d.code department
       from app_user u
       join membership m on m.user_id = u.id and m.property_id=$1
       left join department d on d.id = m.department_id
       where u.status='ACTIVE' and ($2::text is null or d.code=$2)
       order by u.display_name`,
      [a.propertyId, scope.all ? null : scope.department],
    )).rows;
    const settings = await loadSettings(a.propertyId);
    const suppliers = (await pool.query(`select id, name from supplier where property_id=$1 and active order by name`, [a.propertyId])).rows;
    const tickets = (await pool.query(
      `select id, number, title from maintenance_ticket where property_id=$1 and status not in ('DONE','CANCELLED') order by created_at desc limit 30`,
      [a.propertyId],
    )).rows;
    const restocks = (await pool.query(
      `select l.id, i.name, l.created_at from kitchen_stock_log l join kitchen_stock_item i on i.id = l.item_id
       where l.property_id=$1 and l.action='restock' order by l.created_at desc limit 30`,
      [a.propertyId],
    )).rows;
    return {
      month,
      month_label: monthLabel(month),
      today,
      can_set: canSetBudget(who),
      can_log: canLogSpend(who).ok,
      sees_all: scope.all,
      department: a.department,
      categories: settings.categories,
      cards,
      expenses: expenses.map(row => presentExpense(row, who, a.userId)),
      people,
      suppliers,
      tickets: tickets.map((row: { id: string; number: number; title: string }) => ({ id: row.id, label: `#${row.number} ${row.title}` })),
      restocks: restocks.map((row: { id: string; name: string }) => ({ id: row.id, name: row.name })),
    };
  });

  f.get("/v1/spend/settings", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a) return;
    const head = await headOf(a.propertyId, a.userId);
    if (!canSetBudget(viewer(a, head))) return reply.code(403).send(problem(403, "forbidden", "Only the system owner and the general manager can set budgets"));
    const settings = await loadSettings(a.propertyId);
    return { gm_email: settings.gm_email ?? "", notify_heads: settings.notify_heads, categories: settings.categories };
  });

  f.put("/v1/spend/settings", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a) return;
    const head = await headOf(a.propertyId, a.userId);
    if (!canSetBudget(viewer(a, head))) return reply.code(403).send(problem(403, "forbidden", "Only the system owner and the general manager can set budgets"));
    const settings = parseSpendSettings(req.body ?? {});
    await pool.query(
      `update property set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{spend}', $2::jsonb, true) where id=$1`,
      [a.propertyId, JSON.stringify(settings)],
    );
    await dispatchSpendAlerts(a.propertyId);
    return { gm_email: settings.gm_email ?? "", notify_heads: settings.notify_heads, categories: settings.categories };
  });

  f.put("/v1/spend/budgets", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a) return;
    const head = await headOf(a.propertyId, a.userId);
    if (!canSetBudget(viewer(a, head))) return reply.code(403).send(problem(403, "forbidden", "Only the system owner and the general manager can set a budget"));
    const month = String(req.body?.month ?? "");
    if (!validMonth(month)) return reply.code(422).send(problem(422, "validation", "Choose a month"));
    const dept = await resolveDepartment(a.propertyId, req.body?.department ?? req.body?.department_id);
    if (!dept) return reply.code(422).send(problem(422, "validation", "Choose a department"));
    const amount = parsePoundsToPence(req.body?.amount ?? req.body?.amount_pence, { allowZero: true });
    if (!amount.ok) return reply.code(422).send(problem(422, "validation", amount.error));
    const pence = req.body?.amount_pence != null && req.body?.amount == null ? Number(req.body.amount_pence) : amount.pence;
    if (!Number.isInteger(pence) || pence < 0 || pence > 100_000_000) return reply.code(422).send(problem(422, "validation", "Enter a budget in pounds"));
    await tx(async (c: Q) => {
      await c.query(
        `insert into spend_budget (tenant_id, property_id, department_id, month, amount_pence, set_by)
         values ($1,$2,$3,$4::date,$5,$6)
         on conflict (property_id, department_id, month)
         do update set amount_pence=excluded.amount_pence, set_by=excluded.set_by, updated_at=now()`,
        [a.tenantId, a.propertyId, dept.id, monthStart(month), pence, a.userId],
      );
      await audit(c, a, "spend_budget", dept.id, "spend.budget", { payload: { department: dept.code, month, amount_pence: pence } });
    });
    await dispatchSpendAlerts(a.propertyId, { departmentId: dept.id, month });
    return { ok: true };
  });

  f.post("/v1/spend/budgets/copy", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a) return;
    const head = await headOf(a.propertyId, a.userId);
    if (!canSetBudget(viewer(a, head))) return reply.code(403).send(problem(403, "forbidden", "Only the system owner and the general manager can set a budget"));
    const today = await londonToday();
    const month = validMonth(String(req.body?.month ?? "")) ? String(req.body.month) : monthOfDate(today);
    const previous = shiftMonth(month, -1);
    const prior = (await pool.query(
      `select department_id, amount_pence from spend_budget where property_id=$1 and month=$2::date`,
      [a.propertyId, monthStart(previous)],
    )).rows as { department_id: string; amount_pence: number }[];
    const existing = (await pool.query(
      `select department_id from spend_budget where property_id=$1 and month=$2::date`,
      [a.propertyId, monthStart(month)],
    )).rows as { department_id: string }[];
    const copies = copyBudgets(
      prior.map(row => ({ departmentId: row.department_id, amountPence: row.amount_pence })),
      existing.map(row => ({ departmentId: row.department_id })),
    );
    await tx(async (c: Q) => {
      for (const row of copies) {
        await c.query(
          `insert into spend_budget (tenant_id, property_id, department_id, month, amount_pence, set_by)
           values ($1,$2,$3,$4::date,$5,$6)
           on conflict (property_id, department_id, month) do nothing`,
          [a.tenantId, a.propertyId, row.departmentId, monthStart(month), row.amountPence, a.userId],
        );
      }
      await audit(c, a, "spend_budget", a.propertyId, "spend.budget.copy", { payload: { month, copied: copies.length } });
    });
    await dispatchSpendAlerts(a.propertyId, { month });
    return { copied: copies.length };
  });

  f.post("/v1/spend/expenses", async (req: any, reply) => {
    const saved = await saveExpense(req, reply, null);
    return saved;
  });

  f.patch("/v1/spend/expenses/:id", async (req: any, reply) => {
    return saveExpense(req, reply, req.params.id);
  });

  f.get("/v1/spend/expenses/:id", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a) return;
    const head = await headOf(a.propertyId, a.userId);
    const scope = scopeFor(a, head);
    const row = (await pool.query(
      `select e.receipt, d.code department from spend_expense e join department d on d.id=e.department_id
       where e.id=$1 and e.property_id=$2 and e.deleted_at is null`,
      [req.params.id, a.propertyId],
    )).rows[0];
    if (!row || (!scope.all && row.department !== scope.department)) return reply.code(404).send(problem(404, "not_found", "That spend is not on your list"));
    return { receipt: row.receipt };
  });

  f.delete("/v1/spend/expenses/:id", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a) return;
    const head = await headOf(a.propertyId, a.userId);
    const who = viewer(a, head);
    const row = (await pool.query(
      `select e.id, e.logged_by, e.spent_by, e.department_id, d.code department, e.spent_on::text
       from spend_expense e join department d on d.id=e.department_id
       where e.id=$1 and e.property_id=$2 and e.deleted_at is null`,
      [req.params.id, a.propertyId],
    )).rows[0];
    if (!row) return reply.code(404).send(problem(404, "not_found", "That spend is not on your list"));
    if (!mayEditSpend(who, { department: row.department, loggedBy: row.logged_by, spentBy: row.spent_by }, a.userId)) {
      return reply.code(403).send(problem(403, "forbidden", "You can remove your own spend, or a spend in a department you head"));
    }
    await tx(async (c: Q) => {
      await c.query(`update spend_expense set deleted_at=now(), updated_at=now() where id=$1`, [row.id]);
      await audit(c, a, "spend_expense", row.id, "spend.delete", { payload: { department: row.department } });
    });
    await dispatchSpendAlerts(a.propertyId, { departmentId: row.department_id, month: monthOfDate(row.spent_on) });
    return { ok: true };
  });

  f.post("/v1/spend/expenses/:id/review", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a) return;
    const head = await headOf(a.propertyId, a.userId);
    const who = viewer(a, head);
    const status = String(req.body?.review ?? req.body?.status ?? "");
    if (status !== "open" && status !== "checked" && status !== "queried") return reply.code(422).send(problem(422, "validation", "Mark it checked, queried, or open"));
    const note = String(req.body?.note ?? "").trim().slice(0, 300);
    const row = (await pool.query(
      `select e.id, d.code department from spend_expense e join department d on d.id=e.department_id
       where e.id=$1 and e.property_id=$2 and e.deleted_at is null`,
      [req.params.id, a.propertyId],
    )).rows[0];
    if (!row) return reply.code(404).send(problem(404, "not_found", "That spend is not on your list"));
    if (!canCheckSpend(who, row.department)) return reply.code(403).send(problem(403, "forbidden", "A department head, the general manager, or an admin can mark a spend"));
    await tx(async (c: Q) => {
      await c.query(
        `update spend_expense set review=$2, review_note=$3, reviewed_by=$4, reviewed_at=now(), updated_at=now() where id=$1`,
        [row.id, status, note || null, a.userId],
      );
      await audit(c, a, "spend_expense", row.id, "spend.review", { payload: { review: status } });
    });
    return { ok: true, review: status };
  });

  f.get("/v1/spend/report", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a) return;
    const built = await buildReport(a, req.query ?? {});
    return built;
  });

  f.get("/v1/spend/report.csv", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a) return;
    const built = await buildReport(a, req.query ?? {});
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="spend-${built.month}.csv"`);
    return reply.send(spendCsv(built.rows));
  });

  f.get("/v1/spend/report.pdf", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a) return;
    const built = await buildReport(a, req.query ?? {});
    const pdf = spendPdf(reportLines({
      month: built.month,
      byDepartment: built.by_department.map(row => ({ name: row.name, spent: row.spent_pence, budget: row.budget_pence })),
      byCategory: built.by_category.map(row => ({ name: row.name, spent: row.spent_pence })),
      trend: built.trend.map(row => ({ month: row.month, spent: row.spent_pence })),
    }));
    reply.header("content-type", "application/pdf");
    reply.header("content-disposition", `attachment; filename="spend-${built.month}.pdf"`);
    return reply.send(Buffer.from(pdf));
  });
}

async function saveExpense(req: any, reply: any, id: string | null) {
  const a = await actor(req, reply); if (!a) return;
  const head = await headOf(a.propertyId, a.userId);
  const who = viewer(a, head);
  const logging = canLogSpend(who);
  if (!id && !logging.ok) return reply.code(422).send(problem(422, "validation", logging.error));
  const body = req.body ?? {};
  const today = await londonToday();
  const spentOn = String(body.spent_on ?? body.date ?? today);
  if (!validDate(spentOn) || spentOn > today || spentOn < "2020-01-01") return reply.code(422).send(problem(422, "validation", "Choose a date that is not in the future"));
  const amount = parsePoundsToPence(body.amount ?? body.amount_pence);
  if (!amount.ok) return reply.code(422).send(problem(422, "validation", amount.error));
  const description = String(body.description ?? "").trim().slice(0, 500);
  if (!description) return reply.code(422).send(problem(422, "validation", "Say what the money was for"));
  const settings = await loadSettings(a.propertyId);
  const scope = spendScope(who);
  let existing: { id: string; category: string; department: string; department_id: string; logged_by: string; spent_by: string; receipt: string | null } | null = null;
  if (id) {
    existing = (await pool.query(
      `select e.id, e.category, e.logged_by, e.spent_by, e.receipt, e.department_id, d.code department
       from spend_expense e join department d on d.id=e.department_id
       where e.id=$1 and e.property_id=$2 and e.deleted_at is null`,
      [id, a.propertyId],
    )).rows[0] ?? null;
    if (!existing) return reply.code(404).send(problem(404, "not_found", "That spend is not on your list"));
    if (!mayEditSpend(who, { department: existing.department, loggedBy: existing.logged_by, spentBy: existing.spent_by }, a.userId)) {
      return reply.code(403).send(problem(403, "forbidden", "You can change your own spend, or a spend in a department you head"));
    }
  }
  const category = String(body.category ?? "other").trim().toLowerCase();
  if (!categoryAllowed(category, settings.categories, existing?.category)) return reply.code(422).send(problem(422, "validation", "Choose a category"));
  const requested = await resolveDepartment(a.propertyId, body.department ?? body.department_id);
  const dept = scope.all ? requested : await resolveDepartment(a.propertyId, a.department);
  if (!dept) return reply.code(422).send(problem(422, "validation", "Choose a department"));
  if (!scope.all && existing && existing.department !== dept.code) return reply.code(403).send(problem(403, "forbidden", "That spend is in another department"));
  const spentBy = String(body.spent_by || a.userId);
  const person = (await pool.query(
    `select u.id from app_user u join membership m on m.user_id=u.id and m.property_id=$2 where u.id=$1 and u.status='ACTIVE'`,
    [spentBy, a.propertyId],
  )).rows[0];
  if (!person) return reply.code(422).send(problem(422, "validation", "Choose who spent it"));
  let supplierId: string | null = null;
  if (body.supplier_id) {
    const supplier = (await pool.query(`select id from supplier where id=$1 and property_id=$2`, [body.supplier_id, a.propertyId])).rows[0];
    if (!supplier) return reply.code(422).send(problem(422, "validation", "That supplier is not on the register"));
    supplierId = supplier.id;
  }
  let ticketId: string | null = null;
  if (body.ticket_id) {
    const ticket = (await pool.query(`select id from maintenance_ticket where id=$1 and property_id=$2`, [body.ticket_id, a.propertyId])).rows[0];
    if (!ticket) return reply.code(422).send(problem(422, "validation", "That maintenance ticket is not on the list"));
    ticketId = ticket.id;
  }
  let stockLogId: string | null = null;
  if (body.stock_log_id) {
    const stock = (await pool.query(`select id from kitchen_stock_log where id=$1 and property_id=$2 and action='restock'`, [body.stock_log_id, a.propertyId])).rows[0];
    if (!stock) return reply.code(422).send(problem(422, "validation", "That restock is not on the list"));
    stockLogId = stock.id;
  }
  let receipt: string | null = existing?.receipt ?? null;
  if (Object.prototype.hasOwnProperty.call(body, "receipt")) {
    const photo = cleanPhoto(body.receipt);
    if (!photo.ok) return reply.code(422).send(problem(422, "validation", photo.error));
    receipt = photo.photo;
  }
  const saved = await tx(async (c: Q) => {
    if (!existing) {
      const row = (await c.query(
        `insert into spend_expense (tenant_id, property_id, department_id, amount_pence, category, spent_on, spent_by, logged_by, supplier_id, description, receipt, ticket_id, stock_log_id)
         values ($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11,$12,$13) returning id`,
        [a.tenantId, a.propertyId, dept.id, amount.pence, category, spentOn, spentBy, a.userId, supplierId, description, receipt, ticketId, stockLogId],
      )).rows[0];
      await audit(c, a, "spend_expense", row.id, "spend.create", { payload: { department: dept.code, amount_pence: amount.pence, category, spent_on: spentOn } });
      return row.id as string;
    }
    await c.query(
      `update spend_expense set department_id=$2, amount_pence=$3, category=$4, spent_on=$5::date, spent_by=$6, supplier_id=$7, description=$8, receipt=$9, ticket_id=$10, stock_log_id=$11, updated_at=now()
       where id=$1`,
      [existing.id, dept.id, amount.pence, category, spentOn, spentBy, supplierId, description, receipt, ticketId, stockLogId],
    );
    await audit(c, a, "spend_expense", existing.id, "spend.update", { payload: { department: dept.code, amount_pence: amount.pence, category, spent_on: spentOn } });
    return existing.id;
  });
  await dispatchSpendAlerts(a.propertyId, { departmentId: dept.id, month: monthOfDate(spentOn) });
  if (!id) reply.code(201);
  return { id: saved };
}

async function buildReport(a: Actor, query: { month?: string; trend?: string }) {
  const today = await londonToday();
  const month = validMonth(String(query.month ?? "")) ? String(query.month) : monthOfDate(today);
  const trendMonths = String(query.trend) === "12" ? 12 : 6;
  const head = await headOf(a.propertyId, a.userId);
  const scope = scopeFor(a, head);
  const department = scope.all ? null : scope.department;
  const start = monthStart(shiftMonth(month, -(trendMonths - 1)));
  const end = monthStart(shiftMonth(month, 1));
  const byDepartment = (await pool.query(
    `select d.code, d.name, coalesce(b.amount_pence, 0)::int budget_pence,
            coalesce(sum(e.amount_pence), 0)::int spent_pence
     from department d
     left join spend_budget b on b.department_id=d.id and b.month=$2::date
     left join spend_expense e on e.department_id=d.id and e.deleted_at is null
       and e.spent_on >= $2::date and e.spent_on < ($2::date + interval '1 month')
     where d.property_id=$1 and ($3::text is null or d.code=$3)
     group by d.id, d.code, d.name, d.sort_order, b.amount_pence
     order by d.sort_order, d.name`,
    [a.propertyId, monthStart(month), department],
  )).rows as { code: string; name: string; budget_pence: number; spent_pence: number }[];
  const byCategory = (await pool.query(
    `select e.category code, coalesce(sum(e.amount_pence), 0)::int spent_pence
     from spend_expense e join department d on d.id=e.department_id
     where e.property_id=$1 and e.deleted_at is null
       and e.spent_on >= $2::date and e.spent_on < ($2::date + interval '1 month')
       and ($3::text is null or d.code=$3)
     group by e.category order by e.category`,
    [a.propertyId, monthStart(month), department],
  )).rows as { code: string; spent_pence: number }[];
  const trendRows = (await pool.query(
    `select to_char(e.spent_on, 'YYYY-MM') month, coalesce(sum(e.amount_pence), 0)::int spent_pence
     from spend_expense e join department d on d.id=e.department_id
     where e.property_id=$1 and e.deleted_at is null
       and e.spent_on >= $2::date and e.spent_on < $3::date
       and ($4::text is null or d.code=$4)
     group by 1 order by 1`,
    [a.propertyId, start, end, department],
  )).rows as { month: string; spent_pence: number }[];
  const trend = [];
  for (let i = trendMonths - 1; i >= 0; i--) {
    const key = shiftMonth(month, -i);
    const found = trendRows.find(row => row.month === key);
    trend.push({ month: key, label: monthLabel(key), spent_pence: found?.spent_pence ?? 0, spent: formatGbp(found?.spent_pence ?? 0) });
  }
  const settings = await loadSettings(a.propertyId);
  const nameOf = (code: string) => settings.categories.find(item => item.code === code)?.name ?? code;
  const lines = (await pool.query(
    `select d.name department, e.category, e.spent_on::text, e.amount_pence, su.display_name spent_by,
            coalesce(s.name, '') supplier, e.description, e.review
     from spend_expense e
     join department d on d.id=e.department_id
     join app_user su on su.id=e.spent_by
     left join supplier s on s.id=e.supplier_id
     where e.property_id=$1 and e.deleted_at is null
       and e.spent_on >= $2::date and e.spent_on < ($2::date + interval '1 month')
       and ($3::text is null or d.code=$3)
     order by d.name, e.spent_on`,
    [a.propertyId, monthStart(month), department],
  )).rows as { department: string; category: string; spent_on: string; amount_pence: number; spent_by: string; supplier: string; description: string; review: string }[];
  return {
    month,
    month_label: monthLabel(month),
    trend_months: trendMonths,
    by_department: byDepartment.map(row => ({ ...row, spent: formatGbp(row.spent_pence), budget: formatGbp(row.budget_pence), colour: colourBand(row.spent_pence, row.budget_pence) })),
    by_category: byCategory.map(row => ({ code: row.code, name: nameOf(row.code), spent_pence: row.spent_pence, spent: formatGbp(row.spent_pence) })),
    trend,
    rows: lines.map(row => ({
      department: row.department,
      category: row.category,
      spentOn: row.spent_on,
      amountPence: row.amount_pence,
      spentBy: row.spent_by,
      supplier: row.supplier,
      description: row.description,
      review: row.review,
    })),
  };
}
