/**
 * One guest profile, built up across stays.
 * Matching, who may see what, allergen consent, and retention live here.
 * The API stores the rows on the existing person and Guest 360 records.
 */

export type MatchStrength = "email" | "phone" | "name_dob" | "name_postcode";
export type ProfileView = "none" | "kitchen" | "front" | "manager";
export type CardSurface = "profile" | "kitchen" | "front";

export type IncomingGuest = {
  id?: string | null;
  email?: string | null;
  phone?: string | null;
  givenName: string;
  familyName: string;
  dateOfBirth?: string | null;
  postcode?: string | null;
};

export type KnownGuest = IncomingGuest & { id: string; mergedInto?: string | null };

export type MatchHit = { id: string; strength: MatchStrength; autoLink: boolean };

export type AllergenItem = { code: string; severity: string };

export type RetentionSettings = {
  allergen_days_after_departure: number;
  feedback_text_days: number;
  staff_note_days: number;
  profile_inactive_months: number;
};

export const DEFAULT_RETENTION: RetentionSettings = {
  allergen_days_after_departure: 30,
  feedback_text_days: 730,
  staff_note_days: 730,
  profile_inactive_months: 36,
};

const MANAGER_ROLES = new Set([
  "SYSTEM_OWNER", "GENERAL_MANAGER", "OPERATIONS_MANAGER", "FRONT_OFFICE_MANAGER",
  "FINANCE_HR", "RETREAT_MANAGER", "OWNER",
]);
const KITCHEN_ROLES = new Set(["HEAD_CHEF", "KITCHEN", "KITCHEN_PORTER", "KITCHEN_MANAGER", "CHEF"]);
const FRONT_ROLES = new Set([
  "RECEPTIONIST", "NIGHT_PORTER", "SALES_ASSISTANT", "SALES_MANAGER", "PROGRAMME", "RESTAURANT_MANAGER", "FRONT",
]);

export function normaliseEmail(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

/** UK numbers compare equal with or without +44. */
export function normalisePhone(value: string | null | undefined): string {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("0044")) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith("44") && digits.length > 10) digits = `0${digits.slice(2)}`;
  return digits;
}

export function normalisePostcode(value: string | null | undefined): string {
  return String(value ?? "").toUpperCase().replace(/\s+/g, "");
}

export function normaliseName(given: string, family: string): string {
  return `${given} ${family}`.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = a[i - 1] === b[j - 1] ? prev : Math.min(prev, row[j - 1], row[j]) + 1;
      prev = row[j];
      row[j] = next;
    }
  }
  return row[b.length];
}

export function namesClose(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const max = Math.max(a.length, b.length);
  if (max < 5) return false;
  return 1 - levenshtein(a, b) / max >= 0.84;
}

export function matchGuest(incoming: IncomingGuest, known: KnownGuest[]): MatchHit[] {
  const self = incoming.id ?? "";
  const pool = known.filter(row => row.id !== self && !row.mergedInto);
  const email = normaliseEmail(incoming.email);
  if (email.includes("@")) {
    const hits = pool.filter(row => normaliseEmail(row.email) === email);
    if (hits.length) return hits.map(row => ({ id: row.id, strength: "email" as const, autoLink: true }));
  }
  const hits: MatchHit[] = [];
  const phone = normalisePhone(incoming.phone);
  if (phone.length >= 10) {
    for (const row of pool) {
      if (normalisePhone(row.phone) === phone) hits.push({ id: row.id, strength: "phone", autoLink: false });
    }
  }
  const name = normaliseName(incoming.givenName, incoming.familyName);
  const dob = String(incoming.dateOfBirth ?? "").slice(0, 10);
  const postcode = normalisePostcode(incoming.postcode);
  if (name && (dob || postcode)) {
    for (const row of pool) {
      if (hits.some(hit => hit.id === row.id)) continue;
      if (!namesClose(name, normaliseName(row.givenName ?? "", row.familyName ?? ""))) continue;
      const sameDob = !!dob && String(row.dateOfBirth ?? "").slice(0, 10) === dob;
      const samePostcode = !!postcode && normalisePostcode(row.postcode) === postcode;
      if (sameDob) hits.push({ id: row.id, strength: "name_dob", autoLink: false });
      else if (samePostcode) hits.push({ id: row.id, strength: "name_postcode", autoLink: false });
    }
  }
  return hits;
}

export function profileView(role: string, perms: Iterable<string>): ProfileView {
  const set = new Set(perms);
  const code = String(role ?? "").toUpperCase();
  if (set.has("guest.profile.manage") || MANAGER_ROLES.has(code)) return "manager";
  const kitchen = set.has("guest.profile.kitchen") || KITCHEN_ROLES.has(code);
  const front = set.has("guest.profile.front") || FRONT_ROLES.has(code);
  if (kitchen && !front) return "kitchen";
  if (front && !kitchen) return "front";
  if (kitchen && front) return KITCHEN_ROLES.has(code) ? "kitchen" : "front";
  if (set.has("guest.update") || set.has("user.manage")) return "manager";
  if (set.has("diet.read") && !set.has("guest.read")) return "kitchen";
  if (set.has("guest.read")) return "front";
  if (set.has("diet.read")) return "kitchen";
  return "none";
}

/** A surface can narrow what a manager sees. It cannot widen a kitchen or front role. */
export function viewFor(actor: ProfileView, surface: CardSurface): ProfileView {
  if (actor === "none") return "none";
  if (surface === "profile") return actor;
  if (surface === "kitchen") return actor === "front" ? "none" : "kitchen";
  if (actor === "kitchen") return "none";
  return "front";
}

export function canEditNote(authorId: string, actorId: string, manager: boolean): boolean {
  return manager || (!!authorId && authorId === actorId);
}

export function retentionMarker(on: string): string {
  return `deleted per retention policy on ${on}`;
}

export function erasureMarker(on: string): string {
  return `erased at the guest's request on ${on}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  return dt.toISOString().slice(0, 10);
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function parseRetentionSettings(raw: unknown): RetentionSettings {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    allergen_days_after_departure: clampInt(src.allergen_days_after_departure, DEFAULT_RETENTION.allergen_days_after_departure, 1, 3650),
    feedback_text_days: clampInt(src.feedback_text_days, DEFAULT_RETENTION.feedback_text_days, 1, 3650),
    staff_note_days: clampInt(src.staff_note_days, DEFAULT_RETENTION.staff_note_days, 1, 3650),
    profile_inactive_months: clampInt(src.profile_inactive_months, DEFAULT_RETENTION.profile_inactive_months, 1, 240),
  };
}

export function profileDue(lastActivity: string | null | undefined, today: string, months: number, alreadyMarked: boolean): boolean {
  if (alreadyMarked || !lastActivity) return false;
  return addMonths(lastActivity, months) < today;
}

/** Without consent, allergen rows go 30 days after departure. Consent keeps them until the profile itself is due. */
export function allergenDue(args: {
  departure: string | null | undefined;
  today: string;
  days: number;
  consent: boolean;
  alreadyMarked: boolean;
  profileDue: boolean;
}): boolean {
  if (args.alreadyMarked) return false;
  if (args.profileDue) return true;
  if (args.consent) return false;
  if (!args.departure) return false;
  return addDays(args.departure, args.days) < args.today;
}

export function textDue(recordedOn: string | null | undefined, today: string, days: number, alreadyMarked: boolean): boolean {
  if (alreadyMarked || !recordedOn) return false;
  return addDays(recordedOn, days) < today;
}

export function formatAllergens(items: AllergenItem[]): string {
  return items
    .filter(item => item.code)
    .map(item => `${item.code.replace(/_/g, " ")} (${String(item.severity || "unspecified").toLowerCase()})`)
    .join(", ");
}

/**
 * Old allergen history is shown only with consent.
 * A declaration made for the stay being viewed is current kitchen information, not old history.
 * Otherwise the card says to ask again.
 */
export function allergenCard(args: { consent: boolean; history: AllergenItem[]; thisStay: AllergenItem[] }): { line: string; thisStay: string | null } {
  const current = formatAllergens(args.thisStay);
  if (args.consent && args.history.length) {
    return { line: formatAllergens(args.history), thisStay: current || null };
  }
  if (current) return { line: current, thisStay: null };
  return { line: "allergens: ask again", thisStay: null };
}

export type ProfileBundle = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  organisation: string | null;
  dateOfBirth: string | null;
  postcode: string | null;
  vip: boolean;
  preferences: string | null;
  accessibility: string | null;
  roomPreference: string | null;
  specialRequests: string | null;
  notes: { id: string; body: string; authorId: string; author: string; at: string }[];
  allergens: AllergenItem[];
  diet: string[];
  allergenLine: string;
  thisStay: string | null;
  previousStays: number;
  lastVisit: string | null;
  pastIssues: string[];
  compliments: string[];
  feedback: { id: string; scores: string; comment: string | null; capaId: string | null }[];
  stays: { id: string; name: string; arrival: string; departure: string; rooms: string[]; status: string }[];
  consent: boolean;
  consentAt: string | null;
  withdrawnAt: string | null;
  marker: string | null;
};

export function projectProfile(full: ProfileBundle, view: ProfileView): Record<string, unknown> {
  if (view === "kitchen") {
    return {
      id: full.id,
      name: full.name,
      view,
      diet: full.diet,
      allergens: full.allergens,
      allergen_line: full.allergenLine,
      this_stay: full.thisStay,
    };
  }
  if (view === "front") {
    return {
      id: full.id,
      name: full.name,
      view,
      email: full.email,
      phone: full.phone,
      organisation: full.organisation,
      preferences: full.preferences,
      accessibility: full.accessibility,
      room_preference: full.roomPreference,
      special_requests: full.specialRequests,
      previous_stays: full.previousStays,
      last_visit: full.lastVisit,
      stays: full.stays,
    };
  }
  if (view === "manager") return { ...full, view };
  return { id: full.id, name: full.name, view: "none" };
}

export function projectSearch(hit: {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  diet: string[];
  allergenLine: string;
  roomPreference: string | null;
  vip: boolean;
}, view: ProfileView): Record<string, unknown> {
  if (view === "kitchen") return { id: hit.id, display_name: hit.name, view, diet: hit.diet, allergen_line: hit.allergenLine };
  if (view === "front") {
    return {
      id: hit.id, display_name: hit.name, view, email: hit.email, phone: hit.phone, room_preference: hit.roomPreference,
    };
  }
  if (view === "manager") {
    return {
      id: hit.id, display_name: hit.name, view, email: hit.email, phone: hit.phone,
      room_preference: hit.roomPreference, vip: hit.vip, diet: hit.diet, allergen_line: hit.allergenLine,
    };
  }
  return { id: hit.id, display_name: hit.name, view: "none" };
}

export function textPdf(title: string, lines: string[]): string {
  const safe = (value: string) => value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[^\x20-\x7E]/g, "?");
  const commands = ["BT", "/F1 11 Tf", "50 800 Td", "14 TL", `(${safe(title)}) Tj`, "T*"];
  for (const line of lines.slice(0, 48)) commands.push(`(${safe(line.slice(0, 110))}) Tj`, "T*");
  commands.push("ET");
  const stream = commands.join("\n");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
    `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
  ];
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
