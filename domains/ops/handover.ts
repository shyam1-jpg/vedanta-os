/** Shift handover on top of the existing house-log note.
 *  Tags are optional. The incoming shift sees unread notes for their tags.
 *  A rota shift sets the window; otherwise it is since the previous sign-in.
 */

export const DEFAULT_HANDOVER_TAGS = [
  { code: "kitchen", label: "Kitchen" },
  { code: "front", label: "Front of house" },
  { code: "maintenance", label: "Maintenance" },
  { code: "general", label: "General" },
] as const;

export type HandoverTag = { code: string; label: string };
export type WindowReason = "shift" | "login" | "recent";

const DEPT_TAG: Record<string, string> = {
  KITCHEN: "kitchen",
  FRONT: "front",
  RESTAURANT: "front",
  NIGHT: "front",
  MAINT: "maintenance",
  MAINTENANCE: "maintenance",
  HOUSE: "general",
  MGMT: "general",
};

const SEE_ALL = new Set(["GENERAL_MANAGER", "SYSTEM_OWNER", "OPERATIONS_MANAGER"]);

export function slugTag(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

export function parseHandoverTags(raw: unknown): HandoverTag[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: HandoverTag[] = [];
  for (const item of list) {
    const label = String(typeof item === "string" ? item : (item as { label?: unknown } | null)?.label ?? "").trim().slice(0, 40);
    const code = slugTag(typeof item === "object" && item ? String((item as { code?: unknown }).code ?? label) : label);
    if (!code || !label || out.some(t => t.code === code)) continue;
    out.push({ code, label });
  }
  return out.slice(0, 12);
}

export function tagsOrDefault(raw: unknown): HandoverTag[] {
  const parsed = parseHandoverTags(raw);
  return parsed.length ? parsed : DEFAULT_HANDOVER_TAGS.map(t => ({ ...t }));
}

export function staffTagCodes(department: string | null | undefined, role: string | null | undefined): string[] | "all" {
  if (SEE_ALL.has(String(role ?? ""))) return "all";
  const own = DEPT_TAG[String(department ?? "").toUpperCase()] ?? "general";
  return [...new Set([own, "general"])];
}

export function noteVisible(note: { tags?: string[] | null; department?: string | null }, staff: string[] | "all"): boolean {
  if (staff === "all") return true;
  const tags = (note.tags ?? []).filter(Boolean);
  if (tags.length) return tags.some(t => staff.includes(t));
  const legacy = DEPT_TAG[String(note.department ?? "").toUpperCase()] ?? "general";
  return staff.includes(legacy);
}

export function chooseTags(requested: unknown, allowed: HandoverTag[]): { ok: true; tags: string[] } | { ok: false; error: string } {
  if (requested == null) return { ok: true, tags: [] };
  const wanted = Array.isArray(requested) ? requested : [requested];
  if (!wanted.length) return { ok: true, tags: [] };
  const codes = new Set(allowed.map(t => t.code));
  const byLabel = new Map(allowed.map(t => [t.label.toLowerCase(), t.code]));
  const tags: string[] = [];
  for (const item of wanted) {
    const raw = String(item ?? "").trim().toLowerCase();
    if (!raw) continue;
    const code = codes.has(raw) ? raw : byLabel.get(raw);
    if (!code) return { ok: false, error: "That tag is not on the list" };
    if (!tags.includes(code)) tags.push(code);
  }
  return { ok: true, tags: tags.slice(0, 8) };
}

export function handoverWindow(input: { shiftStart?: Date | null; previousLogin?: Date | null; now?: Date }): { since: Date; reason: WindowReason } {
  const now = input.now ?? new Date();
  if (input.shiftStart && !Number.isNaN(input.shiftStart.getTime())) {
    return { since: new Date(input.shiftStart.getTime() - 14 * 60 * 60 * 1000), reason: "shift" };
  }
  if (input.previousLogin && !Number.isNaN(input.previousLogin.getTime())) {
    return { since: input.previousLogin, reason: "login" };
  }
  return { since: new Date(now.getTime() - 18 * 60 * 60 * 1000), reason: "recent" };
}

export function windowLabel(reason: WindowReason): string {
  if (reason === "shift") return "Unread notes for your shift";
  if (reason === "login") return "Unread notes since you last signed in";
  return "Unread notes from the last 18 hours";
}
