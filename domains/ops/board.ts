/** House operations board: handover, checklists, notices, guest requests.
 *  Ideas taken from hotel internal-ops tools (one log instead of WhatsApp),
 *  shaped for a single retreat — not a hotel chain and not a PMS. */

export const OPS_DEPARTMENTS = [
  { code: "HOUSE", label: "Whole house" },
  { code: "FRONT", label: "Front of house" },
  { code: "NIGHT", label: "Night porter" },
  { code: "HK", label: "Housekeeping" },
  { code: "KITCHEN", label: "Kitchen" },
  { code: "RESTAURANT", label: "Restaurant" },
  { code: "MAINT", label: "Maintenance" },
  { code: "GROUNDS", label: "Estate and grounds" },
  { code: "MGMT", label: "Management" },
] as const;

export type OpsDepartment = (typeof OPS_DEPARTMENTS)[number]["code"];
export type OpsShift = "am" | "pm" | "night";
export type GuestRequestStatus = "open" | "doing" | "done";

const DEPT_SET = new Set<string>(OPS_DEPARTMENTS.map(d => d.code));
const LABELS = Object.fromEntries(OPS_DEPARTMENTS.map(d => [d.code, d.label])) as Record<OpsDepartment, string>;

const ROUTE: { dept: OpsDepartment; words: string[] }[] = [
  { dept: "NIGHT", words: ["let me in", "let us in", "locked out", "late arrival", "after hours", "night porter", "come back late", "coming back late"] },
  { dept: "HK", words: ["towel", "linen", "duvet", "pillow", "soap", "shampoo", "clean", "housekeep", "bathroom", "vacuum", "bin"] },
  { dept: "KITCHEN", words: ["food", "meal", "breakfast", "lunch", "dinner", "diet", "vegan", "allergen", "kitchen", "tea", "coffee", "packed"] },
  { dept: "RESTAURANT", words: ["restaurant", "dining", "table", "wine", "waiter"] },
  { dept: "MAINT", words: ["leak", "light", "heat", "heating", "boiler", "broken", "repair", "lock", "window", "wifi", "radiator", "shower"] },
  { dept: "GROUNDS", words: ["garden", "path", "grounds", "lake", "parking", "car park"] },
  { dept: "MGMT", words: ["complaint", "manager", "invoice", "bill"] },
];

export function isOpsDepartment(v: unknown): v is OpsDepartment {
  return typeof v === "string" && DEPT_SET.has(v);
}

export function departmentLabel(code: string | null | undefined): string {
  if (!code) return LABELS.HOUSE;
  return LABELS[code as OpsDepartment] ?? code;
}

export function parseDepartment(v: unknown, fallback: OpsDepartment = "HOUSE"): OpsDepartment {
  const raw = String(v ?? "").trim().toUpperCase();
  return isOpsDepartment(raw) ? raw : fallback;
}

export function parseShift(v: unknown): OpsShift {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "night" || s === "nights" || s === "overnight" || s === "porter") return "night";
  if (s === "pm" || s === "evening") return "pm";
  return "am";
}

export function parseRequestStatus(v: unknown): GuestRequestStatus {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "doing" || s === "in_progress" || s === "progress") return "doing";
  if (s === "done" || s === "closed") return "done";
  return "open";
}

export type GuestRequestRoute = { department: OpsDepartment; request_text: string };

/** The 14 UK allergens, their everyday names, and diet words. These never belong to another department. */
const DIET_TERMS = [
  "peanut", "nut", "gluten", "wheat", "dairy", "milk", "soya", "soy", "sesame", "celery",
  "mustard", "lupin", "sulphites", "sulphite", "sulfite", "molluscs", "mollusc", "crustaceans", "crustacean",
  "fish", "eggs", "egg", "vegan", "coeliac", "celiac", "intolerance", "anaphylaxis", "anaphylactic",
  "allergic", "allergy", "dietary", "diet",
];
const HEALTH_TERMS = new Set(["intolerance", "anaphylaxis", "anaphylactic", "allergic", "allergy", "dietary", "diet", "severe", "epipen"]);
const STOP = new Set(["a", "an", "and", "the", "please", "free", "for", "with", "to", "of", "my", "some", "on", "in", "at", "is", "it", "me", "we", "our", "can", "you", "need", "needs", "also", "plus"]);

function tokens(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

function matchesTerm(text: string, term: string): boolean {
  const parts = term.toLowerCase().split(/\s+/);
  const hay = tokens(text);
  if (parts.length > 1) return hay.join(" ").includes(parts.join(" "));
  const word = parts[0];
  const plural = word.endsWith("y") ? `${word.slice(0, -1)}ies` : `${word}s`;
  return hay.some(token => token === word || token === plural || (word.length >= 4 && token.startsWith(word)));
}

function dietHits(text: string): string[] {
  return DIET_TERMS.filter(term => matchesTerm(text, term));
}

function keywordDepartment(text: string): OpsDepartment {
  for (const row of ROUTE) {
    if (row.words.some(word => matchesTerm(text, word))) return row.dept;
  }
  return "FRONT";
}

function redactDiet(text: string): string {
  let out = ` ${text} `;
  const terms = [...DIET_TERMS, "severe", "epipen", "epi-pen"].sort((a, b) => b.length - a.length);
  for (const term of terms) {
    out = out.replace(new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

function meaningful(text: string): boolean {
  return tokens(text).some(word => !STOP.has(word));
}

/** Kitchen and restaurant always see diet or allergen words. Other departments only see the rest, with those words removed. */
export function planGuestRequest(text: string, explicit?: string | null): GuestRequestRoute[] {
  const raw = text.trim();
  const chosen = String(explicit ?? "").trim().toUpperCase();
  const hits = dietHits(raw);
  if (!hits.length) {
    const department = isOpsDepartment(chosen) ? chosen : keywordDepartment(raw);
    return [{ department, request_text: raw }];
  }
  const severe = /\b(severe|anaphylaxis|anaphylactic|epipen|epi-pen)\b/i.test(raw);
  const labels = [...new Set(hits.filter(term => !HEALTH_TERMS.has(term)))];
  const restaurant = [
    "Buffet. Food is not billed.",
    labels.length ? `Label the buffet for: ${labels.join(", ")}.` : "Label the buffet for the diet noted.",
    "Offer assistance at the buffet if the guest needs it.",
  ].join(" ");
  const routes: GuestRequestRoute[] = [
    { department: "KITCHEN", request_text: severe ? `SEVERE — ${raw}` : raw },
    { department: "RESTAURANT", request_text: restaurant },
  ];
  const redacted = redactDiet(raw);
  if (!meaningful(redacted)) return routes;
  const extra = isOpsDepartment(chosen) && chosen !== "KITCHEN" && chosen !== "RESTAURANT"
    ? chosen
    : keywordDepartment(redacted);
  if (extra === "KITCHEN" || extra === "RESTAURANT") return routes;
  if (extra === "FRONT" && !meaningful(redacted)) return routes;
  routes.push({ department: extra, request_text: redacted });
  return routes;
}

/** Send a free-text guest ask to the department that can actually do it. */
export function routeGuestRequest(text: string, explicit?: string | null): OpsDepartment {
  return planGuestRequest(text, explicit)[0].department;
}

export function shiftLabel(shift: string): string {
  if (shift === "night") return "Night";
  return shift === "pm" ? "Evening" : "Morning";
}

export function groupByDepartment<T extends { department: string | null }>(items: T[]): { code: OpsDepartment; label: string; items: T[] }[] {
  const buckets = new Map<OpsDepartment, T[]>();
  for (const item of items) {
    const code = parseDepartment(item.department, "HOUSE");
    const list = buckets.get(code) ?? [];
    list.push(item);
    buckets.set(code, list);
  }
  return OPS_DEPARTMENTS
    .filter(d => buckets.has(d.code))
    .map(d => ({ code: d.code, label: d.label, items: buckets.get(d.code)! }));
}

export function checklistProgress(items: { done: boolean }[]): { done: number; total: number } {
  return { done: items.filter(i => i.done).length, total: items.length };
}

export function ownGuestRequests<T extends { guestAccountId?: string | null; guestEmail?: string | null }>(
  items: T[],
  guest: { id: string; email: string },
): T[] {
  const email = guest.email.toLowerCase();
  return items.filter(i => i.guestAccountId === guest.id || (i.guestEmail && i.guestEmail.toLowerCase() === email));
}
