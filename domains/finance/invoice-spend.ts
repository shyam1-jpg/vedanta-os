/**
 * Spend from invoices a person has confirmed.
 * A blank total stays blank. A missing income figure stays missing.
 * Retreat names come from the booking the invoice was linked to.
 */
import {
  foodBillBreaksHouse,
  money,
  periodBounds,
  resolveSupplier,
  type Period,
} from "./back-office.ts";

export const NO_INVOICES_YET = "No invoices are attached yet.";
export const ACCOUNTS_NOT_CONNECTED = "Sage, Xero, Payday and Hotelkit are not connected.";
export const INCOME_MISSING = "Income is not recorded in the app, so this is not a profit or loss.";
export const BOOKED_INCOME_MISSING = "Booked income is not recorded, so there is no forecast.";
export const BLANK_TOTAL = "Enter the invoice total. A blank total is not saved.";

export type KnownSupplier = { code: string; name: string };

export type ReadInvoice = {
  supplierName: string | null;
  supplierCode: string | null;
  localShop: boolean;
  date: string | null;
  total: number | null;
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SPECIFIC_DATE = /(?:^|[^a-z])(?:invoice\s+date|tax\s+point|date\s+of\s+issue|dated)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2}\s+[A-Za-z]+\s+\d{4})/i;
const PLAIN_DATE = /^date\s*[:\-]\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2}\s+[A-Za-z]+\s+\d{4})/i;
const TOTAL_LABEL = /\b(grand\s+total|invoice\s+total|amount\s+due|balance\s+due|total\s+due|amount\s+payable|total\s+to\s+pay|total)\b/gi;

function cleanLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function linesOf(text: string): string[] {
  const lines = text.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const paired: string[] = [];
  for (let i = 0; i < lines.length - 1; i++) paired.push(`${lines[i]} ${lines[i + 1]}`);
  return [...lines, ...paired];
}

function appears(text: string, name: string): boolean {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9])${esc}(?:[^A-Za-z0-9]|$)`, "i").test(text);
}

function knownHits(text: string, suppliers: readonly KnownSupplier[]): KnownSupplier[] {
  return suppliers.filter(s => appears(text, s.name));
}

function labeledSupplier(text: string): string | null {
  const patterns = [
    /(?:^|\n)\s*supplier\s*[:\-]\s*([^\n]{2,80})/i,
    /(?:^|\n)\s*vendor\s*[:\-]\s*([^\n]{2,80})/i,
    /(?:^|\n)\s*from\s*:\s*([^\n]{2,80})/i,
  ];
  for (const re of patterns) {
    const match = re.exec(text);
    if (!match) continue;
    const name = cleanLine(match[1]).replace(/[.,;]+$/, "");
    if (name.length >= 2 && name.length <= 80) return name;
  }
  return null;
}

function parseDateToken(token: string): string | null {
  const t = token.trim();
  let year = 0;
  let month = 0;
  let day = 0;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const uk = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(t);
  const long = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(t);
  if (iso) {
    year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]);
  } else if (uk) {
    day = Number(uk[1]); month = Number(uk[2]);
    year = uk[3].length === 2 ? 2000 + Number(uk[3]) : Number(uk[3]);
  } else if (long) {
    const named = MONTHS[long[2].toLowerCase()];
    if (!named) return null;
    day = Number(long[1]); month = named; year = Number(long[3]);
  } else return null;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function uniqueDate(dates: string[]): string | null {
  const found = [...new Set(dates)];
  return found.length === 1 ? found[0] : null;
}

function readDate(lines: string[]): string | null {
  const specific: string[] = [];
  const generic: string[] = [];
  let sawSpecific = false;
  for (const line of lines) {
    const labelled = SPECIFIC_DATE.exec(line);
    if (labelled) {
      sawSpecific = true;
      const parsed = parseDateToken(labelled[1]);
      if (parsed) specific.push(parsed);
      continue;
    }
    if (/^(due|delivery|order|payment)\b/i.test(line)) continue;
    const plain = PLAIN_DATE.exec(line);
    if (plain) {
      const parsed = parseDateToken(plain[1]);
      if (parsed) generic.push(parsed);
    }
  }
  if (sawSpecific) return uniqueDate(specific);
  return uniqueDate(generic);
}

function firstAmount(text: string): number | null {
  const match = /£\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+\.\d{2})|(?<![A-Za-z0-9.])(\d{1,3}(?:,\d{3})*\.\d{2})(?![A-Za-z0-9])/.exec(text);
  if (!match) return null;
  const n = Number((match[1] ?? match[2]).replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return null;
  return money(n);
}

function totalOnLine(line: string): number | null {
  TOTAL_LABEL.lastIndex = 0;
  let chosen: number | null = null;
  let match: RegExpExecArray | null;
  while ((match = TOTAL_LABEL.exec(line))) {
    const word = match[1].toLowerCase().replace(/\s+/g, " ");
    if (word === "total") {
      const before = line.slice(Math.max(0, match.index - 6), match.index);
      if (/sub\s*$/i.test(before)) continue;
      const afterWord = line.slice(match.index, match.index + 28);
      if (/^total\s+(vat|v\.a\.t|tax|net|discount|carriage|shipping)\b/i.test(afterWord)) continue;
    }
    const amount = firstAmount(line.slice(match.index + match[0].length));
    if (amount != null) chosen = amount;
  }
  return chosen;
}

function readTotal(lines: string[]): number | null {
  const found: number[] = [];
  for (const line of lines) {
    const amount = totalOnLine(line);
    if (amount != null) found.push(amount);
  }
  const unique = [...new Set(found)];
  return unique.length === 1 ? unique[0] : null;
}

/** Read supplier, date and total only from labelled text or a single known shop name. */
export function readInvoiceFields(text: string, suppliers: readonly KnownSupplier[]): ReadInvoice {
  const blank: ReadInvoice = { supplierName: null, supplierCode: null, localShop: false, date: null, total: null };
  const source = text.replace(/\u0000/g, " ");
  const lines = linesOf(source);
  const label = labeledSupplier(source);
  let supplierName: string | null = null;
  let supplierCode: string | null = null;
  let localShop = false;
  if (label) {
    const hits = knownHits(label, suppliers);
    if (hits.length === 1) {
      supplierName = hits[0].name;
      supplierCode = hits[0].code;
    } else if (hits.length === 0) {
      supplierName = label;
      localShop = true;
    }
  } else {
    const hits = knownHits(source, suppliers);
    if (hits.length === 1) {
      supplierName = hits[0].name;
      supplierCode = hits[0].code;
    }
  }
  return { ...blank, supplierName, supplierCode, localShop, date: readDate(lines), total: readTotal(lines) };
}

export function confirmInvoice(input: {
  invoiceDate: string;
  total: number | null;
  supplierCode?: string | null;
  localName?: string | null;
  note?: string | null;
}): { ok: true; date: string; total: number; code: string; name: string; local: boolean; note: string | null } | { ok: false; error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.invoiceDate) || !parseDateToken(input.invoiceDate)) return { ok: false, error: "Enter a valid invoice date." };
  if (input.total == null || !Number.isFinite(input.total) || input.total <= 0 || input.total > 1_000_000) {
    return { ok: false, error: BLANK_TOTAL };
  }
  const code = (input.supplierCode ?? "").trim();
  const localName = (input.localName ?? "").trim();
  if (!code && !localName) return { ok: false, error: "Choose the shop. A blank supplier is not saved." };
  const shop = resolveSupplier({ code: code || "LOCAL", localName });
  if (!shop.ok) return shop;
  const note = (input.note ?? "").trim();
  if (note.length > 500) return { ok: false, error: "Keep the note short." };
  const broken = foodBillBreaksHouse(note);
  if (broken) return { ok: false, error: `The house does not buy ${broken}. Vegetarian, no eggs, no onion family, and the cows are not milked.` };
  return { ok: true, date: input.invoiceDate, total: money(input.total), code: shop.code, name: shop.name, local: shop.local, note: note || null };
}

export type SavedInvoice = {
  date: string;
  amount: number;
  bookingId: string | null;
  bookingName: string | null;
};

export type StoredIncome = { date: string; amount: number };

export type BookedStay = {
  id: string;
  name: string;
  arrival: string | null;
  departure: string | null;
  booked: number | null;
};

export type PeriodKey = "day" | "week" | "month" | "year";

export type PeriodMoney = {
  from: string;
  to: string;
  spend: number;
  income: number | null;
  profit: number | null;
  outcome: "profit" | "loss" | "even" | "income_missing";
  pnlMessage: string;
  bookedIncome: number | null;
  forecast: number | null;
  forecastOutcome: "profit" | "loss" | "even" | "income_missing";
  bookingsLeftOut: number;
  forecastMessage: string;
};

export type InvoiceChart = {
  year: string;
  points: { key: string; label: string; spend: number }[];
  hasSpend: boolean;
};

export type InvoiceSpendReport =
  | { empty: true; message: typeof NO_INVOICES_YET; accounts: typeof ACCOUNTS_NOT_CONNECTED }
  | {
      empty: false;
      message: null;
      accounts: typeof ACCOUNTS_NOT_CONNECTED;
      anchor: string;
      periods: Record<PeriodKey, PeriodMoney>;
      retreats: { bookingId: string | null; name: string; spend: number }[];
      chart: InvoiceChart;
    };

function sumSpend(invoices: SavedInvoice[], from: string, to: string): number {
  return money(invoices.filter(row => row.date >= from && row.date <= to).reduce((n, row) => n + row.amount, 0));
}

function sumIncome(income: StoredIncome[] | null, from: string, to: string): number | null {
  if (income == null) return null;
  return money(income.filter(row => row.date >= from && row.date <= to).reduce((n, row) => n + row.amount, 0));
}

function bookedIn(stays: BookedStay[], from: string, to: string): { amount: number | null; leftOut: number } {
  const arrivals = stays.filter(stay => stay.arrival != null && stay.arrival >= from && stay.arrival <= to);
  const known = arrivals.filter(stay => stay.booked != null && Number.isFinite(stay.booked));
  if (!known.length) return { amount: null, leftOut: arrivals.filter(stay => stay.booked == null).length };
  return {
    amount: money(known.reduce((n, stay) => n + (stay.booked as number), 0)),
    leftOut: arrivals.length - known.length,
  };
}

function compared(left: number | null, right: number, missing: string): {
  result: number | null;
  outcome: PeriodMoney["outcome"];
  message: string;
} {
  if (left == null) return { result: null, outcome: "income_missing", message: missing };
  const result = money(left - right);
  if (result > 0) return { result, outcome: "profit", message: "Profit" };
  if (result < 0) return { result, outcome: "loss", message: "Loss" };
  return { result: 0, outcome: "even", message: "Neither profit nor loss." };
}

export function incomeLedgerNote(source: "retreat_income" | "folio_payments" | null): string {
  if (source === "retreat_income") return "Income is guest or retreat revenue already entered. Guests do not pay for food. The only point of sale is reception.";
  if (source === "folio_payments") return "Income is payments already recorded on folios. Guests do not pay for food. The only point of sale is reception.";
  return INCOME_MISSING;
}

function forecastMessage(amount: number | null, leftOut: number): string {
  if (amount == null) return BOOKED_INCOME_MISSING;
  const base = "Forecast from booked income and recorded invoice spend.";
  if (leftOut > 0) return `${base} Retreats with no agreed total stored are left out.`;
  return base;
}

function periodMoney(invoices: SavedInvoice[], income: StoredIncome[] | null, booked: BookedStay[], anchor: string, period: Period): PeriodMoney {
  const { from, to } = periodBounds(anchor, period);
  const spend = sumSpend(invoices, from, to);
  const incomeAmount = sumIncome(income, from, to);
  const pnl = compared(incomeAmount, spend, INCOME_MISSING);
  const agreed = bookedIn(booked, from, to);
  const forecast = compared(agreed.amount, spend, BOOKED_INCOME_MISSING);
  return {
    from,
    to,
    spend,
    income: incomeAmount,
    profit: pnl.result,
    outcome: pnl.outcome,
    pnlMessage: pnl.outcome === "income_missing" ? INCOME_MISSING : pnl.message,
    bookedIncome: agreed.amount,
    forecast: forecast.result,
    forecastOutcome: forecast.outcome,
    bookingsLeftOut: agreed.leftOut,
    forecastMessage: forecastMessage(agreed.amount, agreed.leftOut),
  };
}

function retreatSpend(invoices: SavedInvoice[], from: string, to: string): { bookingId: string | null; name: string; spend: number }[] {
  const map = new Map<string, { bookingId: string | null; name: string; spend: number }>();
  for (const invoice of invoices) {
    if (invoice.date < from || invoice.date > to) continue;
    const key = invoice.bookingId ?? "unassigned";
    const name = invoice.bookingId ? (invoice.bookingName?.trim() || "Unassigned") : "Unassigned";
    const current = map.get(key) ?? { bookingId: invoice.bookingId, name, spend: 0 };
    current.spend = money(current.spend + invoice.amount);
    map.set(key, current);
  }
  return [...map.values()].sort((a, b) => {
    if (a.bookingId == null) return 1;
    if (b.bookingId == null) return -1;
    return a.name.localeCompare(b.name, "en-GB");
  });
}

function yearChart(invoices: SavedInvoice[], year: string): InvoiceChart {
  const points = MONTH_LABELS.map((label, index) => {
    const key = `${year}-${String(index + 1).padStart(2, "0")}`;
    const spend = money(invoices.filter(invoice => invoice.date.startsWith(key)).reduce((n, invoice) => n + invoice.amount, 0));
    return { key, label, spend };
  });
  return { year, points, hasSpend: points.some(point => point.spend !== 0) };
}

export function invoiceSpendReport(input: {
  anchor: string;
  invoices: SavedInvoice[];
  /** Null when the house has no income rows. An empty list is a recorded zero. */
  income: StoredIncome[] | null;
  booked: BookedStay[];
}): InvoiceSpendReport {
  if (input.invoices.length === 0) {
    return { empty: true, message: NO_INVOICES_YET, accounts: ACCOUNTS_NOT_CONNECTED };
  }
  const year = periodBounds(input.anchor, "year");
  const keys: PeriodKey[] = ["day", "week", "month", "year"];
  const periods = Object.fromEntries(keys.map(key => [key, periodMoney(input.invoices, input.income, input.booked, input.anchor, key)])) as Record<PeriodKey, PeriodMoney>;
  return {
    empty: false,
    message: null,
    accounts: ACCOUNTS_NOT_CONNECTED,
    anchor: input.anchor,
    periods,
    retreats: retreatSpend(input.invoices, year.from, year.to),
    chart: yearChart(input.invoices, year.from.slice(0, 4)),
  };
}
