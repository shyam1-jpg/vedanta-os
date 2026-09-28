/** Monthly department budgets and the spend logged against them. Amounts are integer pence, GBP. */

export const DEFAULT_CATEGORIES = [
  { code: "supplies", name: "Supplies" },
  { code: "equipment", name: "Equipment" },
  { code: "repairs", name: "Repairs" },
  { code: "consumables", name: "Consumables" },
  { code: "services", name: "Services" },
  { code: "other", name: "Other" },
] as const;

/** Roles that can mark their own department's spend as checked or queried. */
export const HEAD_ROLES = [
  "HK_SUPERVISOR",
  "HEAD_CHEF",
  "KITCHEN_MANAGER",
  "FRONT_OFFICE_MANAGER",
  "RESTAURANT_MANAGER",
  "MAINTENANCE",
  "ESTATE_MANAGER",
  "GROUNDS_MANAGER",
  "SALES_MANAGER",
  "OPERATIONS_MANAGER",
  "RETREAT_MANAGER",
] as const;

export const REVIEW = ["open", "checked", "queried"] as const;
export type Review = (typeof REVIEW)[number];
export type Band = "green" | "amber" | "red";
export type Pace = "under" | "ahead" | "over";
export type Threshold = "80" | "100";

export type SpendCategory = { code: string; name: string };
export type SpendSettings = { gm_email: string | null; notify_heads: boolean; categories: SpendCategory[] };
export type SpendViewer = {
  role: string;
  department: string | null;
  perms?: Iterable<string>;
  /** Department code of a head seat they hold, when it is their own department. */
  headOf?: string | null;
};

const CAP_PENCE = 100_000_000;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const londonParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function permHas(viewer: SpendViewer, code: string): boolean {
  if (!viewer.perms) return false;
  for (const perm of viewer.perms) if (perm === code) return true;
  return false;
}

export function seesAllSpend(viewer: SpendViewer): boolean {
  return viewer.role === "SYSTEM_OWNER" || viewer.role === "GENERAL_MANAGER" || permHas(viewer, "spend.manage");
}

export function canSetBudget(viewer: SpendViewer): boolean {
  return seesAllSpend(viewer);
}

export function spendScope(viewer: SpendViewer): { all: boolean; department: string | null } {
  if (seesAllSpend(viewer)) return { all: true, department: null };
  return { all: false, department: viewer.department };
}

export function canLogSpend(viewer: SpendViewer): { ok: true } | { ok: false; error: string } {
  if (seesAllSpend(viewer)) return { ok: true };
  if (!viewer.department) return { ok: false, error: "You need a department before you can log a spend" };
  return { ok: true };
}

export function canCheckSpend(viewer: SpendViewer, department: string): boolean {
  if (seesAllSpend(viewer)) return true;
  if (!department || viewer.department !== department) return false;
  if (viewer.headOf === department) return true;
  return (HEAD_ROLES as readonly string[]).includes(viewer.role);
}

export function mayEditSpend(viewer: SpendViewer, row: { department: string; loggedBy: string; spentBy: string }, userId: string): boolean {
  if (canSetBudget(viewer)) return true;
  if (row.loggedBy === userId || row.spentBy === userId) return spendScope(viewer).all || viewer.department === row.department;
  return canCheckSpend(viewer, row.department);
}

export function parseCategories(raw: unknown): SpendCategory[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_CATEGORIES.map(item => ({ code: item.code, name: item.name }));
  const out: SpendCategory[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const src: Record<string, unknown> = item && typeof item === "object" ? item as Record<string, unknown> : { name: item };
    const name = String(src.name ?? "").trim().slice(0, 40);
    const code = String(src.code ?? name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
    if (!name || !code || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, name });
  }
  return out.length ? out : DEFAULT_CATEGORIES.map(item => ({ code: item.code, name: item.name }));
}

export function categoryAllowed(code: string, categories: SpendCategory[], existing?: string | null): boolean {
  if (categories.some(item => item.code === code)) return true;
  return !!existing && existing === code;
}

export function parseSpendSettings(raw: unknown): SpendSettings {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const email = String(src.gm_email ?? "").trim().toLowerCase();
  return {
    gm_email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null,
    notify_heads: src.notify_heads !== false,
    categories: parseCategories(src.categories),
  };
}

/** Pounds as a string or number, stored as integer pence. Expenses need at least one penny. Budgets may be zero. */
export function parsePoundsToPence(raw: unknown, opts?: { allowZero?: boolean }): { ok: true; pence: number } | { ok: false; error: string } {
  if (raw == null || String(raw).trim() === "") return { ok: false, error: "Enter an amount" };
  const text = String(raw).trim().replace(/^£/, "").replace(/,/g, "");
  if (/^-/.test(text)) return { ok: false, error: "Enter a positive amount in pounds" };
  if (/^\d+\.\d{3,}$/.test(text)) return { ok: false, error: "Use pounds and pence, two decimal places at most" };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { ok: false, error: "Enter a positive amount in pounds" };
  const [whole, frac = ""] = text.split(".");
  const pence = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(pence) || pence > CAP_PENCE) return { ok: false, error: "That amount is above £1,000,000" };
  if (pence < 1 && !opts?.allowZero) return { ok: false, error: "Enter at least one penny" };
  return { ok: true, pence };
}

export function formatGbp(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(pence));
  const pounds = Math.floor(abs / 100).toLocaleString("en-GB");
  return `${sign}£${pounds}.${String(abs % 100).padStart(2, "0")}`;
}

export function monthOfDate(ymd: string): string {
  return String(ymd).slice(0, 7);
}

/** Calendar month in Europe/London for an instant, including the BST change. */
export function monthOfInstant(instant: Date): string {
  return londonYmd(instant).slice(0, 7);
}

export function londonYmd(instant: Date): string {
  const parts = londonParts.formatToParts(instant);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function londonDay(ymd: string): number {
  return Number(ymd.slice(8, 10));
}

export function daysInMonth(ym: string): number {
  const [year, month] = ym.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthStart(ym: string): string {
  return `${ym}-01`;
}

export function shiftMonth(ym: string, delta: number): string {
  const [year, month] = ym.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(ym: string): string {
  const [year, month] = ym.split("-");
  return `${MONTHS[Number(month) - 1] ?? ym} ${year}`;
}

export function validMonth(ym: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(ym);
}

export function validDate(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Green under 80%, amber from 80% up to the budget, red at the budget or over. A zero budget with no spend stays green. */
export function colourBand(spent: number, budget: number): Band {
  if (budget <= 0) return spent > 0 ? "red" : "green";
  const ratio = spent / budget;
  if (ratio >= 1) return "red";
  if (ratio >= 0.8) return "amber";
  return "green";
}

export function paceIndicator(spent: number, budget: number, day: number, days: number): { daysLeft: number; pace: Pace } {
  const safeDays = Math.max(1, days);
  const today = Math.min(Math.max(1, day), safeDays);
  const daysLeft = Math.max(0, safeDays - today);
  if (budget <= 0) return { daysLeft, pace: spent > 0 ? "over" : "under" };
  if (spent >= budget) return { daysLeft, pace: "over" };
  const expected = Math.floor(budget * today / safeDays);
  if (spent > expected) return { daysLeft, pace: "ahead" };
  return { daysLeft, pace: "under" };
}

export function paceLabel(pace: Pace, daysLeft: number): string {
  const left = daysLeft === 0 ? "Last day of the month" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;
  const word = pace === "over" ? "Over the budget" : pace === "ahead" ? "Ahead of a straight-line pace" : "Within a straight-line pace";
  return `${left}. ${word}.`;
}

/** Thresholds not yet sent. A zero or missing budget never alerts. Calling again with those marks returns nothing. */
export function thresholdsToSend(spent: number, budget: number, sent: readonly string[]): Threshold[] {
  if (budget <= 0) return [];
  const due: Threshold[] = [];
  const ratio = spent / budget;
  if (ratio >= 0.8 && !sent.includes("80")) due.push("80");
  if (ratio >= 1 && !sent.includes("100")) due.push("100");
  return due;
}

export function copyBudgets(
  previous: { departmentId: string; amountPence: number }[],
  existing: { departmentId: string }[],
): { departmentId: string; amountPence: number }[] {
  const have = new Set(existing.map(row => row.departmentId));
  return previous.filter(row => !have.has(row.departmentId) && row.amountPence >= 0);
}

export function alertText(input: { department: string; spent: number; budget: number; month: string; threshold: Threshold }): { subject: string; body: string } {
  const label = monthLabel(input.month);
  const mark = input.threshold === "100" ? "100%" : "80%";
  return {
    subject: `${input.department} spend has reached ${mark} for ${label}`,
    body: `${input.department} used ${formatGbp(input.spent)} of ${formatGbp(input.budget)} for ${label} (${mark}).`,
  };
}

function csvCell(value: string | number): string {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function spendCsv(rows: { department: string; category: string; spentOn: string; amountPence: number; spentBy: string; supplier: string; description: string; review: string }[]): string {
  const header = ["department", "category", "spent_on", "amount_pence", "amount_gbp", "spent_by", "supplier", "description", "review"];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push([
      row.department,
      row.category,
      row.spentOn,
      row.amountPence,
      (row.amountPence / 100).toFixed(2),
      row.spentBy,
      row.supplier,
      row.description,
      row.review,
    ].map(csvCell).join(","));
  }
  return lines.join("\n") + "\n";
}

function escapePdf(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[^\x20-\x7E]/g, "?");
}

/** A short text PDF for the monthly spend report. Separate from the night-audit renderer. */
export function spendPdf(lines: string[]): string {
  const source = lines.length ? lines : ["Spend report"];
  const chunks: string[][] = [];
  for (let i = 0; i < source.length; i += 46) chunks.push(source.slice(i, i + 46));
  const fontId = 3 + chunks.length * 2;
  const objects: string[] = [];
  objects.push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj");
  objects.push(`2 0 obj << /Type /Pages /Count ${chunks.length} /Kids [${chunks.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] >> endobj`);
  chunks.forEach((chunk, i) => {
    const pageId = 3 + i * 2;
    const contentId = pageId + 1;
    const commands = ["BT", "/F1 11 Tf", "50 800 Td", "14 TL"];
    for (const line of chunk) commands.push(`(${escapePdf(line.slice(0, 110))}) Tj`, "T*");
    commands.push("ET");
    const stream = commands.join("\n");
    objects.push(`${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >> endobj`);
    objects.push(`${contentId} 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`);
  });
  objects.push(`${fontId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`);
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(body.length);
    body += `${obj}\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return body;
}

export function reportLines(input: {
  month: string;
  byDepartment: { name: string; spent: number; budget: number }[];
  byCategory: { name: string; spent: number }[];
  trend: { month: string; spent: number }[];
}): string[] {
  const lines = [`Spend report ${monthLabel(input.month)}`, ""];
  lines.push("By department");
  if (!input.byDepartment.length) lines.push("Nothing spent");
  for (const row of input.byDepartment) {
    lines.push(`${row.name}: ${formatGbp(row.spent)} of ${formatGbp(row.budget)} (${colourBand(row.spent, row.budget)})`);
  }
  lines.push("", "By category");
  if (!input.byCategory.length) lines.push("Nothing spent");
  for (const row of input.byCategory) lines.push(`${row.name}: ${formatGbp(row.spent)}`);
  lines.push("", "Trend");
  for (const row of input.trend) lines.push(`${monthLabel(row.month)}: ${formatGbp(row.spent)}`);
  return lines;
}
