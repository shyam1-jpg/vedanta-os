/** Fault reports on top of the existing maintenance ticket.
 *  Any department can report. Maintenance owns the queue. The general manager
 *  is copied on every report. A fridge or freezer is also copied to the kitchen.
 */

export const DEFAULT_AREAS = ["Kitchen", "Dining room", "Halls", "Grounds", "Goshala"] as const;

export const EQUIPMENT_CATEGORIES = [
  { code: "furniture", label: "Furniture" },
  { code: "plumbing", label: "Plumbing" },
  { code: "electrical", label: "Electrical" },
  { code: "appliance", label: "Appliance" },
] as const;

export const URGENCIES = [
  { code: "SAFETY", label: "Urgent / safety" },
  { code: "URGENT", label: "Today" },
  { code: "NORMAL", label: "When possible" },
] as const;

export type Urgency = (typeof URGENCIES)[number]["code"];

const URGENCY_SET = new Set<string>(URGENCIES.map(u => u.code));
const CATEGORY_SET = new Set<string>(EQUIPMENT_CATEGORIES.map(c => c.code));
const PHOTO_MAX = 700_000;

export const FAULT_FLOW: Record<string, Record<string, string>> = {
  OPEN: { acknowledge: "ACKNOWLEDGED", start: "IN_PROGRESS", wait: "WAITING_PARTS", done: "DONE", cancel: "CANCELLED" },
  ACKNOWLEDGED: { start: "IN_PROGRESS", wait: "WAITING_PARTS", done: "DONE", cancel: "CANCELLED" },
  IN_PROGRESS: { wait: "WAITING_PARTS", done: "DONE", cancel: "CANCELLED" },
  WAITING_PARTS: { start: "IN_PROGRESS", done: "DONE", cancel: "CANCELLED" },
  DONE: { reopen: "OPEN" },
  CANCELLED: { reopen: "OPEN" },
};

const STATUS_WORDS: Record<string, string> = {
  OPEN: "Open",
  ACKNOWLEDGED: "Acknowledged",
  IN_PROGRESS: "In progress",
  WAITING_PARTS: "Waiting for parts",
  DONE: "Fixed",
  CANCELLED: "Cancelled",
};

export type FaultRouting = { maintenance: string; manager: string; kitchen: string };

export const DEFAULT_FAULT_ROUTING: FaultRouting = { maintenance: "", manager: "", kitchen: "" };

export type FaultView = {
  number: number | string;
  description: string;
  location: string;
  equipment: string | null;
  urgency: string;
  reporter: string;
  foodSafety: boolean;
  photo: boolean;
};

export type FaultNotice = {
  to: string;
  audience: "maintenance" | "manager" | "kitchen" | "reporter";
  subject: string;
  body: string;
};

export type FaultDraft = {
  title: string;
  description: string | null;
  room: string | null;
  area: string | null;
  department: string;
  priority: string;
  assetId: string | null;
  equipmentLabel: string | null;
  equipmentCategory: string | null;
  photo: string | null;
  foodSafety: boolean;
  takesRoomOut: boolean;
};

function text(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function emailOrNull(value: unknown): string {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email || !email.includes("@") || /\s/.test(email)) return "";
  return email;
}

export function urgencyLabel(code: string): string {
  return URGENCIES.find(u => u.code === code)?.label ?? STATUS_WORDS[code] ?? code;
}

export function statusWords(code: string): string {
  return STATUS_WORDS[code] ?? code;
}

export function categoryLabel(code: string | null | undefined): string {
  return EQUIPMENT_CATEGORIES.find(c => c.code === code)?.label ?? (code ? code.replace(/_/g, " ") : "");
}

export function isFoodSafetyEquipment(input: { name?: string | null; category?: string | null; label?: string | null }): boolean {
  const blob = [input.name, input.category, input.label].filter(Boolean).join(" ").toLowerCase();
  return /fridge|freezer|walk-?in|cold room|cold-room|chiller/.test(blob);
}

export function nextFaultStatus(from: string, command: string): string | null {
  return FAULT_FLOW[from]?.[command] ?? null;
}

export function parseAreas(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const areas = [...new Set(list.map(v => text(v, 80)).filter(Boolean))].slice(0, 40);
  return areas.length ? areas : [...DEFAULT_AREAS];
}

export function parseFaultRouting(raw: unknown): FaultRouting {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    maintenance: emailOrNull(src.maintenance ?? src.maintenance_email),
    manager: emailOrNull(src.manager ?? src.gm ?? src.gm_email),
    kitchen: emailOrNull(src.kitchen ?? src.kitchen_email),
  };
}

export function cleanPhoto(raw: unknown): { ok: true; photo: string | null } | { ok: false; error: string } {
  if (raw == null || String(raw).trim() === "") return { ok: true, photo: null };
  const photo = String(raw).trim();
  if (!photo.startsWith("data:image/")) return { ok: false, error: "Attach a photo as an image" };
  if (photo.length > PHOTO_MAX) return { ok: false, error: "That photo is too large — use a smaller one" };
  return { ok: true, photo };
}

/** A photo or a PDF, same size limit as a fault photo. */
export function cleanAttachment(raw: unknown): { ok: true; file: string | null } | { ok: false; error: string } {
  if (raw == null || String(raw).trim() === "") return { ok: true, file: null };
  const file = String(raw).trim();
  if (!file.startsWith("data:image/") && !file.startsWith("data:application/pdf")) return { ok: false, error: "Attach a photo or a PDF" };
  if (file.length > PHOTO_MAX) return { ok: false, error: "That file is too large — use a smaller one" };
  return { ok: true, file };
}

export function validateFault(input: {
  title?: unknown;
  description?: unknown;
  room?: unknown;
  location?: unknown;
  area?: unknown;
  department?: unknown;
  priority?: unknown;
  urgency?: unknown;
  asset_id?: unknown;
  equipment_label?: unknown;
  equipment?: unknown;
  equipment_category?: unknown;
  category?: unknown;
  photo?: unknown;
  takes_room_out?: unknown;
  assetName?: string | null;
  assetCategory?: string | null;
  reporterDepartment?: string | null;
}): { ok: true; draft: FaultDraft } | { ok: false; error: string } {
  const description = text(input.description, 4000);
  const title = text(input.title, 200) || description.slice(0, 140);
  if (!title) return { ok: false, error: "Say what the problem is, in plain words" };
  const room = text(input.room, 40) || null;
  const area = text(input.area ?? input.location, 80) || null;
  if (!room && !area) return { ok: false, error: "Choose a room or an area" };
  const urgency = text(input.urgency ?? input.priority, 20).toUpperCase() || "NORMAL";
  if (!URGENCY_SET.has(urgency) && urgency !== "LOW") return { ok: false, error: "Choose how urgent this is" };
  const priority = urgency;
  const categoryRaw = text(input.equipment_category ?? input.category, 40).toLowerCase();
  const equipmentCategory = categoryRaw && CATEGORY_SET.has(categoryRaw) ? categoryRaw : null;
  if (categoryRaw && !equipmentCategory) return { ok: false, error: "That equipment category is not on the list" };
  const equipmentLabel = text(input.equipment_label ?? input.equipment, 160) || null;
  const assetId = text(input.asset_id, 80) || null;
  const photo = cleanPhoto(input.photo);
  if (!photo.ok) return photo;
  const foodSafety = isFoodSafetyEquipment({
    name: input.assetName,
    category: input.assetCategory ?? equipmentCategory,
    label: equipmentLabel,
  });
  const department = text(input.department, 40) || text(input.reporterDepartment, 40) || "HOUSE";
  return {
    ok: true,
    draft: {
      title,
      description: description || null,
      room,
      area: room ? area : area,
      department,
      priority,
      assetId,
      equipmentLabel: equipmentLabel || (input.assetName ? text(input.assetName, 160) : null),
      equipmentCategory,
      photo: photo.photo,
      foodSafety,
      takesRoomOut: !!input.takes_room_out && !!room,
    },
  };
}

function placeLine(fault: FaultView): string[] {
  return [
    `Where: ${fault.location}`,
    fault.equipment ? `Equipment: ${fault.equipment}` : null,
    `Urgency: ${urgencyLabel(fault.urgency)}`,
    `Reported by: ${fault.reporter}`,
    "",
    fault.description,
    fault.photo ? "\nA photo is attached on the ticket." : null,
    fault.foodSafety ? "\nThis is food-safety equipment. The kitchen is copied." : null,
  ].filter((line): line is string => line != null);
}

function pushUnique(notes: FaultNotice[], note: FaultNotice) {
  if (!note.to || notes.some(n => n.to === note.to)) return;
  notes.push(note);
}

export function reportNotices(fault: FaultView, rules: FaultRouting): FaultNotice[] {
  const subject = `${fault.foodSafety ? "Food safety · " : ""}Fault M-${fault.number} — ${fault.location}`;
  const body = [`A fault has been reported.`, "", ...placeLine(fault)].join("\n");
  const notes: FaultNotice[] = [];
  pushUnique(notes, { to: rules.maintenance, audience: "maintenance", subject, body });
  pushUnique(notes, { to: rules.manager, audience: "manager", subject: `Copy: ${subject}`, body });
  if (fault.foodSafety) pushUnique(notes, { to: rules.kitchen, audience: "kitchen", subject, body });
  return notes;
}

export function statusNotices(fault: FaultView, rules: FaultRouting, status: string, reporterEmail: string | null, note: string | null): FaultNotice[] {
  const words = statusWords(status);
  const subject = `M-${fault.number} is ${words.toLowerCase()} — ${fault.location}`;
  const body = [
    `Fault M-${fault.number} is now ${words}.`,
    "",
    ...placeLine(fault),
    note?.trim() ? `\nNote: ${note.trim()}` : null,
  ].filter((line): line is string => line != null).join("\n");
  const notes: FaultNotice[] = [];
  pushUnique(notes, { to: emailOrNull(reporterEmail), audience: "reporter", subject, body });
  pushUnique(notes, { to: rules.manager, audience: "manager", subject, body });
  if (fault.foodSafety) pushUnique(notes, { to: rules.kitchen, audience: "kitchen", subject, body });
  return notes;
}
