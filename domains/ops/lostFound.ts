/** Lost and found. Guest contact is personal data and is cleared once the item is closed. */

export const LOST_CATEGORIES = [
  { code: "clothing", label: "Clothing" },
  { code: "electronics", label: "Electronics" },
  { code: "jewellery", label: "Jewellery" },
  { code: "documents", label: "Documents" },
  { code: "keys", label: "Keys" },
  { code: "bags", label: "Bags" },
  { code: "other", label: "Other" },
] as const;

export const LOST_STATUSES = ["logged", "matched", "claimed", "returned", "disposed", "donated"] as const;
export type LostStatus = (typeof LOST_STATUSES)[number];

export const RETURN_METHODS = [
  { code: "posted", label: "Posted" },
  { code: "collected", label: "Collected" },
] as const;

const NEXT: Record<LostStatus, LostStatus[]> = {
  logged: ["matched", "claimed", "disposed", "donated"],
  matched: ["claimed", "logged", "disposed", "donated"],
  claimed: ["returned", "logged"],
  returned: [],
  disposed: [],
  donated: [],
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function emailOrNull(value: unknown): string {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email || !email.includes("@") || /\s/.test(email)) return "";
  return email;
}

export function categoryOk(value: unknown): boolean {
  return LOST_CATEGORIES.some(c => c.code === value);
}

export function parseLostSettings(raw: unknown): { hold_days: number; manager: string } {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const days = Math.round(Number(src.hold_days ?? 90));
  return {
    hold_days: Number.isFinite(days) ? Math.min(3650, Math.max(7, days)) : 90,
    manager: emailOrNull(src.manager ?? src.gm),
  };
}

export function nextLostStatus(from: string, to: string): LostStatus | null {
  const allowed = NEXT[from as LostStatus];
  if (!allowed || !allowed.includes(to as LostStatus)) return null;
  return to as LostStatus;
}

export function closedStatus(status: string): boolean {
  return status === "returned" || status === "disposed" || status === "donated";
}

export function heldTooLong(foundOn: string, today: string, holdDays: number, status: string): boolean {
  if (closedStatus(status)) return false;
  const found = Date.parse(`${foundOn}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(found) || !Number.isFinite(now)) return false;
  return (now - found) / 86_400_000 >= holdDays;
}

function words(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2);
}

export function matchScore(
  report: { description: string; category?: string | null; place?: string | null; happened_on?: string | null },
  item: { description: string; category?: string | null; place?: string | null; found_on?: string | null; status: string },
): number {
  if (closedStatus(item.status)) return 0;
  let score = 0;
  const wanted = new Set(words(report.description));
  const overlap = words(item.description).filter(word => wanted.has(word));
  score += overlap.length * 3;
  if (report.category && report.category === item.category) score += 2;
  if (report.place && item.place && report.place.toLowerCase() === item.place.toLowerCase()) score += 3;
  if (report.happened_on && item.found_on && DATE.test(report.happened_on) && DATE.test(item.found_on)) {
    const days = Math.abs(Date.parse(`${item.found_on}T00:00:00Z`) - Date.parse(`${report.happened_on}T00:00:00Z`)) / 86_400_000;
    if (days <= 2) score += 3;
    else if (days <= 14) score += 1;
  }
  return score;
}

export function suggestMatches<T extends { id: string; description: string; category?: string | null; place?: string | null; found_on?: string | null; status: string }>(
  report: { description: string; category?: string | null; place?: string | null; happened_on?: string | null },
  items: T[],
): T[] {
  return items
    .map(item => ({ item, score: matchScore(report, item) }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(row => row.item);
}

export function parseFoundItem(raw: unknown): {
  ok: true; description: string; category: string; place: string; foundOn: string; storage: string;
} | { ok: false; error: string } {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const description = String(src.description ?? "").trim().slice(0, 500);
  if (description.length < 3) return { ok: false, error: "Describe what was found" };
  const category = String(src.category ?? "other").trim();
  if (!categoryOk(category)) return { ok: false, error: "Choose a category" };
  const place = String(src.place ?? src.location ?? "").trim().slice(0, 80);
  if (!place) return { ok: false, error: "Say where it was found" };
  const foundOn = String(src.found_on ?? "").slice(0, 10);
  if (!DATE.test(foundOn)) return { ok: false, error: "Choose the date it was found" };
  const storage = String(src.storage ?? src.storage_location ?? "").trim().slice(0, 120);
  return { ok: true, description, category, place, foundOn, storage };
}

export function parseMissingReport(raw: unknown): {
  ok: true; description: string; category: string; place: string; happenedOn: string; contactName: string; contactEmail: string; contactPhone: string;
} | { ok: false; error: string } {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const description = String(src.description ?? "").trim().slice(0, 500);
  if (description.length < 3) return { ok: false, error: "Describe what is missing" };
  const category = String(src.category ?? "other").trim();
  if (!categoryOk(category)) return { ok: false, error: "Choose a category" };
  const place = String(src.place ?? src.location ?? "").trim().slice(0, 80);
  const happenedOn = String(src.happened_on ?? "").slice(0, 10);
  if (happenedOn && !DATE.test(happenedOn)) return { ok: false, error: "That date is not valid" };
  const contactEmail = emailOrNull(src.contact_email);
  if (String(src.contact_email ?? "").trim() && !contactEmail) return { ok: false, error: "That email address is not valid" };
  return {
    ok: true,
    description,
    category,
    place,
    happenedOn,
    contactName: String(src.contact_name ?? "").trim().slice(0, 80),
    contactEmail,
    contactPhone: String(src.contact_phone ?? "").trim().slice(0, 30),
  };
}

export function parseStatusChange(raw: unknown, from: string): {
  ok: true; status: LostStatus; claimant: string; method: string | null; note: string;
} | { ok: false; error: string } {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const status = nextLostStatus(from, String(src.status ?? ""));
  if (!status) return { ok: false, error: "That status is not the next step" };
  const claimant = String(src.claimant_name ?? "").trim().slice(0, 80);
  const method = String(src.return_method ?? "").trim();
  if ((status === "claimed" || status === "returned") && claimant.length < 2) return { ok: false, error: "Say who claimed it" };
  if (status === "returned" && method !== "posted" && method !== "collected") return { ok: false, error: "Say whether it was posted or collected" };
  return { ok: true, status, claimant, method: status === "returned" ? method : null, note: String(src.note ?? "").trim().slice(0, 500) };
}

export function retentionNotice(count: number, holdDays: number): { subject: string; body: string } {
  return {
    subject: `Lost property held more than ${holdDays} days`,
    body: `${count} found item${count === 1 ? "" : "s"} ${count === 1 ? "has" : "have"} been held longer than ${holdDays} days. Review them for return, disposal, or donation. Do not put guest contact details in a reply.`,
  };
}
