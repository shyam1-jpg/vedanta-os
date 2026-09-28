/** Induction and training. Cleared for unsupervised work only when every required item is signed off and still in date. */

export const TRAINING_CATEGORIES = [
  { code: "fire_safety", label: "Fire safety" },
  { code: "food_hygiene", label: "Food hygiene" },
  { code: "allergen", label: "Allergen awareness" },
  { code: "gdpr", label: "Data protection / GDPR" },
  { code: "health_safety", label: "Health and safety" },
  { code: "manual_handling", label: "Manual handling" },
  { code: "coshh", label: "COSHH" },
  { code: "role_specific", label: "Role-specific" },
  { code: "other", label: "Other" },
] as const;

export type TrainingCategory = (typeof TRAINING_CATEGORIES)[number]["code"];
export type TrainingStatus = "not_started" | "in_progress" | "completed";
export type TrainingTone = "none" | "not_started" | "in_progress" | "cleared" | "expired";

export const EXAMPLE_TRAINING = [
  { title: "Example fire safety induction", category: "fire_safety" as const, required: true, certificate: false, validMonths: null },
  { title: "Example food hygiene level 2", category: "food_hygiene" as const, required: true, certificate: true, validMonths: 36 },
  { title: "Example allergen awareness", category: "allergen" as const, required: true, certificate: false, validMonths: null },
  { title: "Example data protection briefing", category: "gdpr" as const, required: true, certificate: false, validMonths: null },
  { title: "Example health and safety induction", category: "health_safety" as const, required: true, certificate: false, validMonths: null },
  { title: "Example manual handling", category: "manual_handling" as const, required: true, certificate: false, validMonths: null },
  { title: "Example COSHH awareness", category: "coshh" as const, required: false, certificate: false, validMonths: null },
  { title: "Example role briefing", category: "role_specific" as const, required: false, certificate: false, validMonths: null },
];

export const EXAMPLE_TEMPLATES = [
  { name: "Example chef induction", role: "HEAD_CHEF", department: "KITCHEN", items: ["Example fire safety induction", "Example food hygiene level 2", "Example allergen awareness", "Example COSHH awareness"] },
  { name: "Example kitchen porter induction", role: "KITCHEN_PORTER", department: "KITCHEN", items: ["Example fire safety induction", "Example food hygiene level 2", "Example manual handling"] },
  { name: "Example front of house induction", role: "RECEPTIONIST", department: "FRONT", items: ["Example fire safety induction", "Example allergen awareness", "Example data protection briefing"] },
  { name: "Example housekeeping induction", role: "HK_ATTENDANT", department: "HK", items: ["Example fire safety induction", "Example manual handling", "Example COSHH awareness"] },
  { name: "Example maintenance induction", role: "MAINTENANCE", department: "MAINT", items: ["Example fire safety induction", "Example manual handling", "Example health and safety induction"] },
];

export const EXAMPLE_TRAINING_NOTE = "Example — replace this with the house's own training.";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function emailOrNull(value: unknown): string {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email || !email.includes("@") || /\s/.test(email)) return "";
  return email;
}

export function categoryOk(value: unknown): value is TrainingCategory {
  return TRAINING_CATEGORIES.some(c => c.code === value);
}

export function categoryLabel(code: string | null | undefined): string {
  return TRAINING_CATEGORIES.find(c => c.code === code)?.label ?? "Other";
}

export function parseTrainingSettings(raw: unknown): { leads: number[]; manager: string } {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const list = Array.isArray(src.leads) ? src.leads : [];
  const leads = [...new Set(list.map(n => Math.round(Number(n))).filter(n => Number.isFinite(n) && n >= 0 && n <= 365))].sort((a, b) => b - a);
  return { leads: leads.length ? leads.slice(0, 6) : [60, 30, 7], manager: emailOrNull(src.manager) };
}

export function isExpired(expiresOn: string | null | undefined, today: string): boolean {
  return !!expiresOn && expiresOn < today;
}

export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  return dt.toISOString().slice(0, 10);
}

/** No checklist means not inducted. Required items must be signed off and still in date. */
export function clearedForWork(rows: { required: boolean; signedOff: boolean; expiresOn?: string | null }[], today: string): boolean {
  if (rows.length === 0) return false;
  return rows.filter(row => row.required).every(row => row.signedOff && !isExpired(row.expiresOn, today));
}

export function cellTone(assigned: boolean, status: string, signedOff: boolean, expiresOn: string | null, today: string): TrainingTone {
  if (!assigned) return "none";
  if (signedOff && isExpired(expiresOn, today)) return "expired";
  if (signedOff) return "cleared";
  if (status === "in_progress") return "in_progress";
  return "not_started";
}

export function pendingTrainingAlerts(expiresOn: string | null, today: string, leads: number[], already: string[]): string[] {
  if (!expiresOn) return [];
  const left = Math.round((Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (left < 0) return already.includes("expired") ? [] : ["expired"];
  return leads.filter(lead => left <= lead && !already.includes(String(lead))).map(String);
}

export type TrainingNotice = { to: string; audience: "staff" | "manager"; subject: string; body: string };

export function trainingNotices(item: { title: string; person: string; expiresOn: string; kind: string }, emails: { staff: string; manager: string }): TrainingNotice[] {
  const when = item.kind === "expired"
    ? `${item.person}'s ${item.title} expired on ${item.expiresOn}.`
    : `${item.person}'s ${item.title} expires on ${item.expiresOn}. This reminder is ${item.kind} day${item.kind === "1" ? "" : "s"} before.`;
  const subject = item.kind === "expired" ? `Training expired · ${item.title}` : `Training due to expire · ${item.title}`;
  const body = [when, "", "Renew it and have a manager sign it off on the training tracker."].join("\n");
  const notes: TrainingNotice[] = [];
  const push = (to: string, audience: TrainingNotice["audience"]) => {
    if (!to || notes.some(n => n.to === to)) return;
    notes.push({ to, audience, subject, body });
  };
  push(emails.staff, "staff");
  push(emails.manager, "manager");
  return notes;
}

export function parseTrainingItem(raw: unknown): {
  ok: true;
  title: string; description: string; category: TrainingCategory; required: boolean;
  certificate: boolean; validMonths: number | null; sopId: string | null; link: string;
} | { ok: false; error: string } {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const title = String(src.title ?? "").trim().slice(0, 160);
  if (title.length < 2) return { ok: false, error: "Give the training a title" };
  const category = String(src.category ?? "");
  if (!categoryOk(category)) return { ok: false, error: "Choose a category" };
  const certificate = src.certificate === true || src.certificate === "true";
  let validMonths: number | null = null;
  if (certificate) {
    const years = src.valid_years != null && src.valid_years !== "" ? Number(src.valid_years) : null;
    const months = src.valid_months != null && src.valid_months !== "" ? Number(src.valid_months) : null;
    validMonths = years != null && Number.isFinite(years) ? Math.round(years * 12) : months != null ? Math.round(months) : null;
    if (!validMonths || validMonths < 1 || validMonths > 120) return { ok: false, error: "Say how many years the certificate lasts" };
  }
  const sopId = String(src.sop_id ?? "").trim();
  if (sopId && !/^[0-9a-f-]{36}$/i.test(sopId)) return { ok: false, error: "Choose an SOP from the list" };
  const link = String(src.link ?? "").trim().slice(0, 300);
  if (link && !/^https?:\/\//i.test(link)) return { ok: false, error: "A link needs to start with http:// or https://" };
  return {
    ok: true,
    title,
    description: String(src.description ?? "").trim().slice(0, 2000),
    category,
    required: src.required === true || src.required === "true",
    certificate,
    validMonths,
    sopId: sopId || null,
    link,
  };
}

export function parseTemplate(raw: unknown): { ok: true; name: string; role: string; department: string } | { ok: false; error: string } {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const name = String(src.name ?? "").trim().slice(0, 120);
  if (name.length < 2) return { ok: false, error: "Name the induction" };
  const role = String(src.role_code ?? src.role ?? "").trim().slice(0, 40);
  const department = String(src.department ?? "").trim().slice(0, 40);
  if (!role && !department) return { ok: false, error: "Choose a role or a department" };
  return { ok: true, name, role, department };
}

/** From the phone, staff can say they have done it. Only a manager moves it to signed off. */
export function staffProgress(from: string): TrainingStatus | null {
  if (from === "not_started" || from === "in_progress") return "in_progress";
  return null;
}
