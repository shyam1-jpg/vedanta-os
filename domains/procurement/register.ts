/** Supplier register. Examples are obviously not real businesses. */

export const SUPPLIER_CATEGORIES = [
  { code: "food", label: "Food" },
  { code: "cleaning", label: "Cleaning" },
  { code: "maintenance", label: "Maintenance parts" },
  { code: "consumables", label: "Consumables" },
  { code: "services", label: "Services" },
] as const;

export const DELIVERY_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const DELIVERY_RESULTS = ["received", "partial", "missed"] as const;

export const EXAMPLE_SUPPLIERS = [
  { name: "Example Dry Goods", code: "EX-DRY", categories: ["food"], days: ["mon", "thu"], email: "orders@example-dry-goods.invalid" },
  { name: "Example Clean Co", code: "EX-CLEAN", categories: ["cleaning"], days: ["tue"], email: "hello@example-clean-co.invalid" },
  { name: "Example Fixings", code: "EX-FIX", categories: ["maintenance"], days: ["wed"], email: "desk@example-fixings.invalid" },
  { name: "Example Paper and Soap", code: "EX-PAPER", categories: ["consumables"], days: ["fri"], email: "orders@example-paper-soap.invalid" },
  { name: "Example Linen Service", code: "EX-LINEN", categories: ["services"], days: ["mon"], email: "rota@example-linen.invalid" },
];

export const EXAMPLE_SUPPLIER_NOTE = "Example — not a real supplier.";

const DAY_INDEX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function emailOrNull(value: unknown): string {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email || !email.includes("@") || /\s/.test(email)) return "";
  return email;
}

export function categoriesOk(values: string[]): boolean {
  return values.every(value => SUPPLIER_CATEGORIES.some(c => c.code === value));
}

export function isFoodSupplier(categories: string[]): boolean {
  return categories.includes("food");
}

export function deliveryAlert(next: string | null | undefined, today: string): "today" | "overdue" | null {
  if (!next) return null;
  if (next === today) return "today";
  if (next < today) return "overdue";
  return null;
}

export function nextDelivery(from: string, days: string[], every: number | null, unit: string | null): string | null {
  const known = days.filter(day => day in DAY_INDEX);
  if (known.length) {
    const start = new Date(`${from}T00:00:00Z`);
    for (let i = 1; i <= 14; i++) {
      const date = new Date(start);
      date.setUTCDate(date.getUTCDate() + i);
      const name = Object.entries(DAY_INDEX).find(([, n]) => n === date.getUTCDay())?.[0];
      if (name && known.includes(name)) return date.toISOString().slice(0, 10);
    }
  }
  if (every && every > 0 && (unit === "day" || unit === "week")) {
    const date = new Date(`${from}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + every * (unit === "week" ? 7 : 1));
    return date.toISOString().slice(0, 10);
  }
  return null;
}

export type DeliveryNotice = { to: string; audience: "kitchen" | "buyer"; subject: string; body: string };

export function deliveryNotices(
  supplier: { name: string; kind: "today" | "overdue" | "missed"; due: string },
  food: boolean,
  emails: { kitchen: string; buyer: string },
): DeliveryNotice[] {
  const subject = supplier.kind === "today"
    ? `Delivery due today · ${supplier.name}`
    : supplier.kind === "missed"
      ? `Delivery missed · ${supplier.name}`
      : `Delivery overdue · ${supplier.name}`;
  const line = supplier.kind === "today"
    ? `${supplier.name} is due to deliver today (${supplier.due}).`
    : supplier.kind === "missed"
      ? `${supplier.name} was marked as a missed delivery for ${supplier.due}.`
      : `${supplier.name} was due on ${supplier.due} and has not been logged.`;
  const body = [line, "", "Log it on the supplier register when it arrives."].join("\n");
  const notes: DeliveryNotice[] = [];
  const push = (to: string, audience: DeliveryNotice["audience"]) => {
    if (!to || notes.some(n => n.to === to)) return;
    notes.push({ to, audience, subject, body });
  };
  if (food) push(emails.kitchen, "kitchen");
  push(emails.buyer, "buyer");
  return notes;
}

export function parseSupplier(raw: unknown): {
  ok: true;
  name: string; categories: string[]; contactName: string; phone: string; email: string; address: string;
  account: string; days: string[]; every: number | null; unit: string | null; nextDelivery: string; lead: number | null; notes: string; active: boolean;
} | { ok: false; error: string } {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const name = String(src.name ?? "").trim().slice(0, 160);
  if (name.length < 2) return { ok: false, error: "Give the supplier a name" };
  const categories = (Array.isArray(src.categories) ? src.categories : String(src.categories ?? "").split(","))
    .map(value => String(value).trim()).filter(Boolean);
  if (!categories.length || !categoriesOk(categories)) return { ok: false, error: "Choose what they supply" };
  const days = (Array.isArray(src.days) ? src.days : String(src.delivery_days ?? "").split(","))
    .map(value => String(value).trim().toLowerCase().slice(0, 3)).filter(day => day in DAY_INDEX);
  const everyRaw = src.every_n == null || src.every_n === "" ? null : Math.round(Number(src.every_n));
  const unit = src.every_unit == null || src.every_unit === "" ? null : String(src.every_unit);
  if (everyRaw != null && (!Number.isFinite(everyRaw) || everyRaw < 1 || everyRaw > 365)) return { ok: false, error: "Say how often they deliver" };
  if (unit && unit !== "day" && unit !== "week") return { ok: false, error: "Choose days or weeks" };
  const next = String(src.next_delivery ?? "").slice(0, 10);
  if (next && !/^\d{4}-\d{2}-\d{2}$/.test(next)) return { ok: false, error: "That delivery date is not valid" };
  const emailRaw = String(src.email ?? src.contact_email ?? "").trim();
  const email = emailOrNull(emailRaw);
  if (emailRaw && !email) return { ok: false, error: "That email address is not valid" };
  const leadRaw = src.lead_time_days == null || src.lead_time_days === "" ? null : Math.round(Number(src.lead_time_days));
  if (leadRaw != null && (!Number.isFinite(leadRaw) || leadRaw < 0 || leadRaw > 90)) return { ok: false, error: "Lead time is a number of days" };
  return {
    ok: true,
    name,
    categories,
    contactName: String(src.contact_name ?? "").trim().slice(0, 80),
    phone: String(src.phone ?? src.contact_phone ?? "").trim().slice(0, 30),
    email,
    address: String(src.address ?? "").trim().slice(0, 240),
    account: String(src.account_number ?? "").trim().slice(0, 40),
    days,
    every: everyRaw,
    unit: everyRaw ? unit : null,
    nextDelivery: next,
    lead: leadRaw,
    notes: String(src.notes ?? "").trim().slice(0, 500),
    active: src.active !== false && src.active !== "false",
  };
}

export function parseDelivery(raw: unknown): { ok: true; status: "received" | "partial" | "missed"; note: string } | { ok: false; error: string } {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const status = String(src.status ?? "");
  if (status !== "received" && status !== "partial" && status !== "missed") return { ok: false, error: "Say whether it was received, partial, or missed" };
  return { ok: true, status, note: String(src.note ?? "").trim().slice(0, 500) };
}

export function supplierCode(name: string): string {
  const code = name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
  return code || "SUPPLIER";
}
