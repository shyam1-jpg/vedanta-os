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

export function stockNotices(item: { name: string; quantity: number; unit: string; threshold: number }, rules: StockRouting): StockNotice[] {
  const subject = `Low stock · ${item.name}`;
  const body = [
    `${item.name} is down to ${item.quantity} ${item.unit}.`,
    `The line for ordering more is ${item.threshold} ${item.unit}.`,
    "",
    "This note is sent once. It is sent again only after the item is restocked and falls below the line again.",
  ].join("\n");
  const notes: StockNotice[] = [];
  const push = (to: string, audience: StockNotice["audience"]) => {
    if (!to || notes.some(n => n.to === to)) return;
    notes.push({ to, audience, subject, body });
  };
  push(rules.kitchen, "kitchen");
  push(rules.buyer, "buyer");
  return notes;
}
