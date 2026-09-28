/** Compliance calendar. Status comes from the next due date. A completion keeps history and rolls a repeating item forward. */

export const COMPLIANCE_CATEGORIES = [
  { code: "fire_safety", label: "Fire safety" },
  { code: "food_safety", label: "Food safety" },
  { code: "gdpr", label: "GDPR / data protection" },
  { code: "insurance", label: "Insurance" },
  { code: "equipment", label: "Equipment certification" },
  { code: "health_safety", label: "Health and safety" },
  { code: "licensing", label: "Licensing" },
  { code: "other", label: "Other" },
] as const;

export type ComplianceCategory = (typeof COMPLIANCE_CATEGORIES)[number]["code"];
export type ScheduleUnit = "day" | "week" | "month" | "year";
export type ComplianceStatus = "upcoming" | "due" | "overdue" | "completed";

export const EXAMPLE_COMPLIANCE = [
  { title: "Fire suppression and extinguisher service", category: "fire_safety" as const, every: 1, unit: "year" as const, daysAhead: 40 },
  { title: "Fire alarm test", category: "fire_safety" as const, every: 1, unit: "week" as const, daysAhead: 3 },
  { title: "Food hygiene inspection", category: "food_safety" as const, every: 1, unit: "year" as const, daysAhead: 20 },
  { title: "GDPR review", category: "gdpr" as const, every: 1, unit: "year" as const, daysAhead: 60 },
  { title: "Insurance renewal", category: "insurance" as const, every: 1, unit: "year" as const, daysAhead: 14 },
  { title: "PAT testing", category: "equipment" as const, every: 1, unit: "year" as const, daysAhead: 90 },
  { title: "Gas safety", category: "health_safety" as const, every: 1, unit: "year" as const, daysAhead: 100 },
  { title: "Legionella risk assessment", category: "health_safety" as const, every: 1, unit: "year" as const, daysAhead: 50 },
  { title: "Fridge and freezer calibration", category: "food_safety" as const, every: 6, unit: "month" as const, daysAhead: 10 },
];

export const EXAMPLE_COMPLIANCE_NOTE = "Example — change this to the house's own date.";

const UNITS = new Set<ScheduleUnit>(["day", "week", "month", "year"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function emailOrNull(value: unknown): string {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email || !email.includes("@") || /\s/.test(email)) return "";
  return email;
}

export function categoryOk(value: unknown): value is ComplianceCategory {
  return COMPLIANCE_CATEGORIES.some(c => c.code === value);
}

export function categoryLabel(code: string | null | undefined): string {
  return COMPLIANCE_CATEGORIES.find(c => c.code === code)?.label ?? "Other";
}

export function parseLeads(raw: unknown): number[] {
  const list = Array.isArray(raw) ? raw : [];
  const leads = [...new Set(list.map(n => Math.round(Number(n))).filter(n => Number.isFinite(n) && n >= 0 && n <= 365))].sort((a, b) => b - a);
  return leads.length ? leads.slice(0, 6) : [30, 7, 1];
}

export function parseComplianceSettings(raw: unknown): { leads: number[]; manager: string } {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    leads: parseLeads(src.leads ?? src.lead_days),
    manager: emailOrNull(src.manager ?? src.gm),
  };
}

export function addInterval(iso: string, every: number, unit: ScheduleUnit): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const n = Math.max(1, every);
  if (unit === "day") dt.setUTCDate(dt.getUTCDate() + n);
  else if (unit === "week") dt.setUTCDate(dt.getUTCDate() + n * 7);
  else if (unit === "month") dt.setUTCMonth(dt.getUTCMonth() + n);
  else dt.setUTCFullYear(dt.getUTCFullYear() + n);
  return dt.toISOString().slice(0, 10);
}

export function daysUntil(due: string, today: string): number {
  const a = Date.parse(`${due}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  return Math.round((a - b) / 86_400_000);
}

export function itemStatus(nextDue: string | null | undefined, today: string): ComplianceStatus {
  if (!nextDue) return "completed";
  const left = daysUntil(nextDue, today);
  if (left < 0) return "overdue";
  if (left === 0) return "due";
  return "upcoming";
}

/** Move a repeating item past today. A one-off stays finished. */
export function rollDue(nextDue: string, every: number | null, unit: ScheduleUnit | null, today: string, repeating: boolean): string | null {
  if (!repeating || !every || !unit) return null;
  let next = addInterval(nextDue, every, unit);
  for (let i = 0; i < 400 && next <= today; i++) next = addInterval(next, every, unit);
  return next;
}

export function pendingAlerts(due: string | null, today: string, leads: number[], already: string[]): string[] {
  if (!due) return [];
  const left = daysUntil(due, today);
  const out: string[] = [];
  if (left < 0) {
    if (!already.includes("overdue")) out.push("overdue");
    return out;
  }
  for (const lead of leads) {
    const kind = String(lead);
    if (left <= lead && !already.includes(kind)) out.push(kind);
  }
  return out;
}

export type ComplianceNotice = { to: string; audience: "responsible" | "manager"; subject: string; body: string };

export function complianceNotices(
  item: { title: string; due: string; kind: string },
  emails: { responsible: string; manager: string },
): ComplianceNotice[] {
  const when = item.kind === "overdue"
    ? `${item.title} was due on ${item.due} and is still open.`
    : item.kind === "0"
      ? `${item.title} is due today (${item.due}).`
      : `${item.title} is due on ${item.due}. This reminder is ${item.kind} day${item.kind === "1" ? "" : "s"} before.`;
  const subject = `Compliance · ${item.title}`;
  const body = [when, "", "Log the completion on the compliance calendar when it is done."].join("\n");
  const notes: ComplianceNotice[] = [];
  const push = (to: string, audience: ComplianceNotice["audience"]) => {
    if (!to || notes.some(n => n.to === to)) return;
    notes.push({ to, audience, subject, body });
  };
  push(emails.responsible, "responsible");
  push(emails.manager, "manager");
  return notes;
}

export function parseComplianceItem(raw: unknown): {
  ok: true;
  title: string;
  category: ComplianceCategory;
  repeating: boolean;
  every: number | null;
  unit: ScheduleUnit | null;
  nextDue: string;
  responsibleUserId: string | null;
} | { ok: false; error: string } {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const title = String(src.title ?? "").trim().slice(0, 160);
  if (title.length < 2) return { ok: false, error: "Give the item a title" };
  const category = String(src.category ?? "").trim();
  if (!categoryOk(category)) return { ok: false, error: "Choose a category" };
  const repeating = src.repeating === true || src.schedule === "recurring" || src.repeating === "true";
  let every: number | null = null;
  let unit: ScheduleUnit | null = null;
  if (repeating) {
    every = Math.round(Number(src.every ?? src.every_n));
    unit = String(src.unit ?? src.every_unit) as ScheduleUnit;
    if (!Number.isFinite(every) || every < 1 || every > 365) return { ok: false, error: "Say how often it repeats" };
    if (!UNITS.has(unit)) return { ok: false, error: "Choose days, weeks, months, or years" };
  }
  const nextDue = String(src.next_due ?? src.due ?? "").slice(0, 10);
  if (!DATE.test(nextDue)) return { ok: false, error: "Choose the next due date" };
  const responsible = String(src.responsible_user_id ?? "").trim();
  if (responsible && !/^[0-9a-f-]{36}$/i.test(responsible)) return { ok: false, error: "Choose a person from the list" };
  return { ok: true, title, category, repeating, every, unit, nextDue, responsibleUserId: responsible || null };
}

export function scheduleLabel(repeating: boolean, every: number | null, unit: string | null): string {
  if (!repeating || !every || !unit) return "One-off";
  const word = every === 1 ? { day: "day", week: "week", month: "month", year: "year" }[unit] ?? unit : `${every} ${unit}s`;
  return `Every ${word}`;
}
