/** Induction and training. Cleared for unsupervised work only when every required item is signed off and still in date. */

export const TRAINING_CATEGORIES = [
  { code: "fire_safety", label: "Fire safety" },
  { code: "food_hygiene", label: "Food hygiene" },
  { code: "allergen", label: "Allergen awareness" },
  { code: "gdpr", label: "Data protection / GDPR" },
  { code: "health_safety", label: "Health and safety" },
  { code: "manual_handling", label: "Manual handling" },
  { code: "coshh", label: "COSHH" },
  { code: "hygiene", label: "Hygiene" },
  { code: "knife", label: "Knife skills" },
  { code: "guest_service", label: "Guest service" },
  { code: "accessibility", label: "Accessibility awareness" },
  { code: "equipment", label: "Equipment handling" },
  { code: "cleaning", label: "Cleaning standards" },
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

export type ModuleShare = "department" | "selected" | "all";

/** The general manager and the system owner see every department. Everyone else sees their own. */
export const TRAINING_ALL_ROLES = ["SYSTEM_OWNER", "GENERAL_MANAGER"] as const;

export const MODULE_EXAMPLE_NOTE = "Example — edit this to match the house. It is not a finished course.";

type DefaultModule = {
  key: string;
  title: string;
  category: TrainingCategory;
  share: ModuleShare;
  locked: boolean;
  required: boolean;
  certificate: boolean;
  validMonths: number | null;
  departments: string[];
  checks: string[];
};

/** Editable defaults. Fire safety is one module on every department. Chemical safety is shared by maintenance and housekeeping. */
export const DEPARTMENT_MODULES: DefaultModule[] = [
  {
    key: "fire",
    title: "Fire safety",
    category: "fire_safety",
    share: "all",
    locked: true,
    required: true,
    certificate: true,
    validMonths: 12,
    departments: [],
    checks: [
      "Find the fire exits and the assembly point",
      "Raise the alarm and call for help",
      "Use an extinguisher only if you are trained and it is safe",
    ],
  },
  {
    key: "food",
    title: "Food safety",
    category: "food_hygiene",
    share: "department",
    locked: false,
    required: true,
    certificate: true,
    validMonths: 36,
    departments: ["KITCHEN"],
    checks: [
      "Wash hands before handling food",
      "Keep hot food hot and cold food cold",
      "Keep allergens away from the food they do not belong in",
    ],
  },
  {
    key: "allergen",
    title: "Allergen awareness",
    category: "allergen",
    share: "department",
    locked: false,
    required: true,
    certificate: false,
    validMonths: null,
    departments: ["KITCHEN"],
    checks: [
      "Read the allergen on the booking before service",
      "Know the severe and anaphylactic marks",
      "Tell a manager if a guest's diet is unclear",
    ],
  },
  {
    key: "hygiene",
    title: "Hygiene",
    category: "hygiene",
    share: "department",
    locked: false,
    required: true,
    certificate: false,
    validMonths: null,
    departments: ["KITCHEN"],
    checks: [
      "Wear clean work clothes",
      "Keep the bench and the sink clean",
      "Cover a cut and change gloves",
    ],
  },
  {
    key: "knife",
    title: "Knife skills",
    category: "knife",
    share: "department",
    locked: false,
    required: true,
    certificate: false,
    validMonths: null,
    departments: ["KITCHEN"],
    checks: [
      "Carry a knife point down",
      "Use a stable board",
      "Store knives in the rack, not in a sink of water",
    ],
  },
  {
    key: "guest",
    title: "Guest service",
    category: "guest_service",
    share: "department",
    locked: false,
    required: true,
    certificate: false,
    validMonths: null,
    departments: ["FRONT"],
    checks: [
      "Greet the guest and use their name",
      "Know today's arrivals and who needs assistance",
      "Pass a problem to the right department",
    ],
  },
  {
    key: "access",
    title: "Accessibility awareness",
    category: "accessibility",
    share: "department",
    locked: false,
    required: true,
    certificate: false,
    validMonths: null,
    departments: ["FRONT"],
    checks: [
      "Ask what help the guest wants",
      "Keep routes clear",
      "Know which rooms have step-free access",
    ],
  },
  {
    key: "equipment",
    title: "Equipment handling",
    category: "equipment",
    share: "department",
    locked: false,
    required: true,
    certificate: false,
    validMonths: null,
    departments: ["MAINT"],
    checks: [
      "Check a machine is isolated before you work on it",
      "Use the right tool",
      "Report a fault before you leave it",
    ],
  },
  {
    key: "coshh",
    title: "Chemical safety (COSHH)",
    category: "coshh",
    share: "selected",
    locked: false,
    required: true,
    certificate: false,
    validMonths: null,
    departments: ["MAINT", "HK"],
    checks: [
      "Read the label and the COSHH sheet",
      "Wear the protection the sheet asks for",
      "Store chemicals in the locked cupboard",
    ],
  },
  {
    key: "cleaning",
    title: "Cleaning standards",
    category: "cleaning",
    share: "department",
    locked: false,
    required: true,
    certificate: false,
    validMonths: null,
    departments: ["HK"],
    checks: [
      "Clean a departure room to the checklist",
      "Keep clean and used linen apart",
      "Report damage before the next guest",
    ],
  },
];

export type PlacedModule = DefaultModule & { placements: { department: string; sort: number }[] };

/** Fire safety is placed on every department the property actually has. The others keep their own list. */
export function placeDefaultModules(propertyDepartments: string[]): PlacedModule[] {
  const depts = [...new Set(propertyDepartments)];
  const locals = DEPARTMENT_MODULES.filter(mod => mod.share !== "all");
  return DEPARTMENT_MODULES.map(mod => {
    const placed = mod.share === "all" ? depts : mod.departments.filter(code => depts.includes(code));
    const placements = placed.map(department => {
      const localIndex = locals.filter(other => other.departments.includes(department)).findIndex(other => other.key === mod.key);
      return { department, sort: mod.share === "all" ? 0 : localIndex + 1 };
    });
    return { ...mod, placements };
  });
}

export type Scope = { all: boolean; departments: string[] };

export function trainingScope(input: { role: string; departments: string[] }): Scope {
  return {
    all: (TRAINING_ALL_ROLES as readonly string[]).includes(input.role),
    departments: [...new Set(input.departments.filter(Boolean))],
  };
}

export type ScopedModule = { id: string; title: string; share: ModuleShare; departments: string[]; active?: boolean };

export function modulesInScope(modules: ScopedModule[], scope: Scope): ScopedModule[] {
  const active = modules.filter(mod => mod.active !== false);
  if (scope.all) return active;
  const mine = new Set(scope.departments);
  return active.filter(mod => mod.share === "all" || mod.departments.some(code => mine.has(code)));
}

export function moduleVisible(mod: { share: ModuleShare; departments: string[] }, scope: Scope): boolean {
  return modulesInScope([{ id: "_", title: "", ...mod }], scope).length === 1;
}

/** An induction for a role starts from that department's modules, then adds anything the template names on top. */
export function inductionItemIds(template: { department: string | null; itemIds: string[] }, modules: ScopedModule[]): string[] {
  const base = template.department
    ? modulesInScope(modules, { all: false, departments: [template.department] }).map(mod => mod.id)
    : [];
  return [...new Set([...base, ...template.itemIds])];
}

export function canEditDepartment(scope: Scope, department: string | null): boolean {
  if (scope.all) return true;
  return !!department && scope.departments.includes(department);
}

export function canEditModule(scope: Scope, mod: { share: ModuleShare; departments: string[] }): boolean {
  if (scope.all) return true;
  if (mod.departments.some(code => scope.departments.includes(code))) return true;
  return mod.share === "all" && scope.departments.length > 0;
}

export function detachModule(
  mod: { share: ModuleShare; locked: boolean; departments: string[] },
  department: string,
): { ok: true; departments: string[] } | { ok: false; error: string } {
  if (mod.locked || mod.share === "all") {
    return { ok: false, error: "This module stays on every department. You can edit it, not remove it." };
  }
  if (!mod.departments.includes(department)) return { ok: false, error: "That module is not on this department" };
  return { ok: true, departments: mod.departments.filter(code => code !== department) };
}

export function nextShare(
  current: { share: ModuleShare; locked: boolean },
  change: { mandatoryAll?: boolean; shared?: boolean },
): { ok: true; share: ModuleShare } | { ok: false; error: string } {
  let share = current.share;
  if (change.mandatoryAll === true) share = "all";
  else if (change.mandatoryAll === false) share = change.shared ? "selected" : "department";
  else if (change.shared === true && share !== "all") share = "selected";
  else if (change.shared === false && share === "selected") share = "department";
  if (current.locked && share !== "all") {
    return { ok: false, error: "Fire safety stays mandatory for every department. You can edit the module." };
  }
  return { ok: true, share };
}

export type ChecklistPlan = {
  ok: true;
  changed: boolean;
  clearSignoff: boolean;
  removeIds: string[];
  upserts: { id: string | null; label: string; sort: number }[];
};

/** A checklist edit keeps ticks for steps that are still there. Sign-off stays unless this edit asks for training again. */
export function planChecklistEdit(
  current: { id: string; label: string }[],
  next: { id?: string | null; label?: string }[],
  requiresRetraining: boolean,
): ChecklistPlan | { ok: false; error: string } {
  if (next.length > 40) return { ok: false, error: "A checklist can have up to 40 steps" };
  const known = new Set(current.map(step => step.id));
  const upserts: ChecklistPlan["upserts"] = [];
  const seen = new Set<string>();
  for (const step of next) {
    const label = String(step.label ?? "").trim().slice(0, 200);
    if (label.length < 2) return { ok: false, error: "Each checklist step needs a few words" };
    const id = step.id && known.has(step.id) && !seen.has(step.id) ? step.id : null;
    if (id) seen.add(id);
    upserts.push({ id, label, sort: upserts.length });
  }
  const removeIds = current.filter(step => !seen.has(step.id)).map(step => step.id);
  const changed = removeIds.length > 0
    || upserts.some(step => !step.id)
    || upserts.some(step => current.find(row => row.id === step.id)?.label !== step.label)
    || current.map(step => step.id).join("|") !== upserts.map(step => step.id ?? "").join("|");
  return { ok: true, changed, clearSignoff: changed && requiresRetraining, removeIds, upserts };
}

export function ticksAfterEdit(ticks: string[], removeIds: string[]): string[] {
  const drop = new Set(removeIds);
  return ticks.filter(id => !drop.has(id));
}

export function signoffAfterEdit(signedOff: boolean, plan: { clearSignoff: boolean }): boolean {
  if (!signedOff) return false;
  return !plan.clearSignoff;
}
