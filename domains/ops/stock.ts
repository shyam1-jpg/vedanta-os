/** A short kitchen stock list. Not a purchasing system.
 *  The house kitchen is vegetarian: no eggs, no onion or garlic family.
 */

export type StockOp = "use" | "restock" | "set";
export type StockRouting = { kitchen: string; buyer: string };
export type StockNotice = { to: string; audience: "kitchen" | "buyer"; subject: string; body: string };

export const EXAMPLE_STOCK = [
  { name: "Basmati rice", unit: "kg", quantity: 20, low: 5 },
  { name: "Chickpeas", unit: "kg", quantity: 8, low: 2 },
  { name: "Ghee", unit: "kg", quantity: 3, low: 1 },
  { name: "Oat milk", unit: "litres", quantity: 12, low: 4 },
  { name: "Paper towels", unit: "packs", quantity: 6, low: 2 },
  { name: "Dishwasher detergent", unit: "bottles", quantity: 2, low: 1 },
] as const;

export const EXAMPLE_NOTE = "Example — change this to what the kitchen keeps.";

const FORBIDDEN = /\b(egg|eggs|onion|onions|garlic|shallot|shallots|leek|leeks|chive|chives)\b/i;

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function emailOrNull(value: unknown): string {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email || !email.includes("@") || /\s/.test(email)) return "";
  return email;
}

export function exampleListIsVegetarian(): boolean {
  return EXAMPLE_STOCK.every(item => !FORBIDDEN.test(item.name));
}

export function parseStockRouting(raw: unknown): StockRouting {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    kitchen: emailOrNull(src.kitchen ?? src.kitchen_email),
    buyer: emailOrNull(src.buyer ?? src.orderer ?? src.purchasing),
  };
}

export function applyCount(current: number, op: unknown, amount: unknown): { ok: true; next: number; delta: number; action: StockOp } | { ok: false; error: string } {
  if (op !== "use" && op !== "restock" && op !== "set") return { ok: false, error: "Say whether this was used, restocked, or a new count" };
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: "Enter a quantity" };
  if (op !== "set" && n === 0) return { ok: false, error: "Enter how much changed" };
  const cur = round3(current);
  const qty = round3(n);
  const next = round3(op === "set" ? qty : op === "use" ? cur - qty : cur + qty);
  if (next < 0) return { ok: false, error: "There isn't that much left" };
  return { ok: true, next, delta: round3(next - cur), action: op };
}

/** Send once when the count falls below the line. Stay quiet until it is back above. */
export function stockAlert(_before: number, after: number, threshold: number, alreadyAlerted: boolean): "send" | "clear" | "quiet" {
  const low = after < threshold;
  if (low && !alreadyAlerted) return "send";
  if (!low && alreadyAlerted) return "clear";
  return "quiet";
}

export type ReorderSettings = {
  /** Off leaves the low-stock note as it is and does not write purchase orders. */
  enabled: boolean;
  /** Supplier id -> true emails that supplier when a draft is raised. Missing or false waits for a manager. */
  autoSend: Record<string, boolean>;
};

export function parseReorderSettings(raw: unknown): ReorderSettings {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const box = src.reorder && typeof src.reorder === "object" ? src.reorder as Record<string, unknown> : src;
  const autoSrc = box.auto_send && typeof box.auto_send === "object" ? box.auto_send as Record<string, unknown> : {};
  const autoSend: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(autoSrc)) {
    if (/^[0-9a-f-]{36}$/i.test(key) && value === true) autoSend[key.toLowerCase()] = true;
  }
  return { enabled: box.enabled === true, autoSend };
}

export function vegetarianName(name: string): { ok: true } | { ok: false; error: string } {
  if (FORBIDDEN.test(name)) return { ok: false, error: "The kitchen is vegetarian: no eggs, and no onion, garlic, shallot, leek, or chive." };
  return { ok: true };
}

export type OrderItem = {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  par: number;
  threshold: number | null;
  low: number;
  packSize: number;
  supplierId: string | null;
  supplierName: string | null;
  supplierEmail: string | null;
};

export type OrderLine = {
  itemId: string;
  name: string;
  unit: string;
  packs: number;
  packSize: number;
  quantity: number;
};

export type SupplierOrder = {
  supplierId: string | null;
  supplierKey: string;
  supplierName: string;
  supplierEmail: string | null;
  autoSend: boolean;
  lines: OrderLine[];
};

export function reorderThreshold(item: { threshold: number | null; low: number }): number {
  return item.threshold != null && item.threshold > 0 ? item.threshold : item.low;
}

/** Whole packs needed to reach par. Nothing is ordered at or above the line, or when par is not above the count. */
export function packsToOrder(item: { quantity: number; par: number; threshold: number; packSize: number }): number {
  if (!(item.quantity < item.threshold)) return 0;
  if (!(item.par > item.quantity)) return 0;
  const pack = item.packSize > 0 ? item.packSize : 1;
  const need = item.par - item.quantity;
  return Math.ceil(need / pack - 1e-9);
}

export function groupOrders(items: OrderItem[], settings: ReorderSettings): SupplierOrder[] {
  if (!settings.enabled) return [];
  const groups = new Map<string, SupplierOrder>();
  for (const item of items) {
    if (!vegetarianName(item.name).ok) continue;
    const threshold = reorderThreshold(item);
    const packSize = item.packSize > 0 ? item.packSize : 1;
    const packs = packsToOrder({ quantity: item.quantity, par: item.par, threshold, packSize });
    if (packs <= 0) continue;
    const key = item.supplierId ? item.supplierId.toLowerCase() : "";
    const order = groups.get(key) ?? {
      supplierId: item.supplierId,
      supplierKey: key,
      supplierName: item.supplierName || (item.supplierId ? "Supplier" : "No preferred supplier"),
      supplierEmail: item.supplierEmail,
      autoSend: key ? settings.autoSend[key] === true : false,
      lines: [],
    };
    order.lines.push({
      itemId: item.id,
      name: item.name,
      unit: item.unit,
      packs,
      packSize,
      quantity: round3(packs * packSize),
    });
    groups.set(key, order);
  }
  return [...groups.values()];
}

export function orderMessage(order: { supplierName: string; lines: OrderLine[] }): { subject: string; body: string } {
  const lines = order.lines.map(line => `${line.packs} × ${line.packSize} ${line.unit} ${line.name} (${line.quantity} ${line.unit})`);
  return {
    subject: `Kitchen order · ${order.supplierName}`,
    body: [
      "Please supply the following for the house kitchen.",
      "",
      ...lines,
      "",
      "The menu is vegetarian: no eggs, and no onion, garlic, shallot, leek, or chive.",
    ].join("\n"),
  };
}

export function stockNotices(
  item: { name: string; quantity: number; unit: string; threshold: number },
  rules: StockRouting,
  supplier?: { name: string; phone?: string | null; email?: string | null } | null,
): StockNotice[] {
  const contact = supplier?.name
    ? `Preferred supplier: ${supplier.name}${supplier.phone ? ` · ${supplier.phone}` : ""}${supplier.email ? ` · ${supplier.email}` : ""}.`
    : null;
  const subject = `Low stock · ${item.name}`;
  const body = [
    `${item.name} is down to ${item.quantity} ${item.unit}.`,
    `The line for ordering more is ${item.threshold} ${item.unit}.`,
    contact,
    "",
    "This note is sent once. It is sent again only after the item is restocked and falls below the line again.",
  ].filter(line => line != null).join("\n");
  const notes: StockNotice[] = [];
  const push = (to: string, audience: StockNotice["audience"]) => {
    if (!to || notes.some(n => n.to === to)) return;
    notes.push({ to, audience, subject, body });
  };
  push(rules.kitchen, "kitchen");
  push(rules.buyer, "buyer");
  return notes;
}
