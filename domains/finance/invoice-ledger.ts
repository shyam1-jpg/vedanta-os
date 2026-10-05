/** Conservative extraction: uncertain OCR is a draft, never accounting authority. */
import { readInvoiceFields, type KnownSupplier } from "./invoice-spend.ts";
export type InvoiceLine = { code: string; description: string; quantity: number | null; unit: string; unitPrice: number | null; net: number | null };
export type LedgerFields = { documentType: "invoice" | "credit"; invoiceNumber: string; purchaseDate: string; dueDate: string; currency: string; subtotal: number | null; vat: number | null; lines: InvoiceLine[] };
export type LedgerItem = LedgerFields & { id: string; filename: string; date: string; total: number; supplierName: string; supplierCode: string; bookingName: string | null; note: string | null };
export const roundMoney = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export function validDate(s: unknown): s is string {
  return typeof s === "string" && /^20\d{2}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
}
export function decimal(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") return NaN;
  if (!/^\d+(?:\.\d{1,4})?$/.test(String(value).trim())) return NaN;
  const n = Number(value); return Number.isFinite(n) && n <= 1_000_000 ? n : NaN;
}
function labelledAmount(text: string, label: string): number | null {
  const re = new RegExp(`^\\s*(?:${label})\\s*[:]?\\s*(?:GBP|£)?\\s*([\\d,]+\\.\\d{2})\\s*$`, "gim");
  const values = [...text.matchAll(re)].map(m => Number(m[1].replaceAll(",", "")));
  return values.length && new Set(values).size === 1 && values[0] <= 1_000_000 ? values[0] : null;
}
function labelledDate(text: string, label: string): string {
  const m = new RegExp(`(?:^|\\n)\\s*${label}\\s*:?\\s*(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/-]\\d{1,2}[/-]\\d{4})`, "i").exec(text);
  if (!m) return "";
  const p = m[1].split(/[/-]/); const date = p[0].length === 4 ? m[1] : `${p[2]}-${p[1].padStart(2,"0")}-${p[0].padStart(2,"0")}`;
  return validDate(date) ? date : "";
}
export function extractInvoice(text: string, suppliers: readonly KnownSupplier[]) {
  const source = text.slice(0, 120_000).replaceAll("\u0000", " ");
  const basic = readInvoiceFields(source, suppliers);
  // Do not let the legacy two-line parser pick a product price after an ambiguous total label.
  basic.total = labelledAmount(source,"grand\\s+total|invoice\\s+total|credit\\s+total|amount\\s+due|total\\s+due|total");
  const currencies = new Set<string>();
  if (/£|\bGBP\b/i.test(source)) currencies.add("GBP");
  if (/€|\bEUR\b/i.test(source)) currencies.add("EUR");
  if (/\$|\b(?:USD|CAD|AUD)\b/i.test(source)) currencies.add("OTHER");
  const currency = currencies.size > 1 ? "MIXED" : [...currencies][0] ?? "";
  const documentType = /\bcredit\s+(?:note|memo)\b/i.test(source) ? "credit" as const : "invoice" as const;
  const invoiceNumber = /(?:^|\n)\s*(?:invoice|credit\s+(?:note|memo))\s*(?:no\.?|number|#)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9/_-]{0,79})/i.exec(source)?.[1] ?? "";
  const lines: InvoiceLine[] = [];
  // Deliberately limited to clear rows: code, description, quantity, optional unit, unit price, line net.
  // Unrecognised layouts are left for manual entry, not fabricated from unrelated numbers.
  let inTable = false;
  for (const row of source.split(/\r?\n/)) {
    if (/\b(?:qty|quantity)\b/i.test(row) && /\b(?:price|amount|total|net)\b/i.test(row)) { inTable = true; continue; }
    if (!inTable) continue;
    if (/^\s*(?:sub\s*total|vat|tax|grand\s+total|total|amount\s+due|balance\s+due)\b/i.test(row)) { inTable = false; continue; }
    const m = /^\s*([A-Za-z0-9][A-Za-z0-9/_-]{0,39})[\s|]+(.+?)[\s|]+(\d+(?:\.\d{1,3})?)[\s|]+(?:(kg|g|l|ml|ea|each|case|pack|box)[\s|]+)?[£]?([\d,]+\.\d{2})[\s|]+[£]?([\d,]+\.\d{2})\s*$/i.exec(row);
    if (m && lines.length < 100) lines.push({code:m[1],description:m[2].replace(/\s*\|\s*/g," ").trim(),quantity:Number(m[3]),unit:m[4]??"",unitPrice:Number(m[5].replaceAll(",","")),net:Number(m[6].replaceAll(",",""))});
  }
  return {...basic, documentType, invoiceNumber, currency, purchaseDate:labelledDate(source,"purchase\\s+date"), dueDate:labelledDate(source,"due\\s+date"), subtotal:labelledAmount(source,"sub\\s*total|total\\s+net|net\\s+total"),vat:labelledAmount(source,"vat|total\\s+vat|tax\\s+total"), lines};
}
export function validateLedger(input: Record<string, unknown>): {ok:true; value:LedgerFields} | {ok:false;error:string} {
  const fail = (error: string) => ({ok:false as const,error});
  if (input.reviewed !== true) return fail("Check the document and tick the confirmation before saving.");
  if (input.documentType !== "invoice" && input.documentType !== "credit") return fail("Choose invoice or credit note.");
  if (input.currency !== "GBP") return fail("This ledger records GBP only. Do not relabel a foreign-currency invoice as GBP.");
  if (!validDate(input.invoiceDate)) return fail("Enter a real invoice date.");
  const invoiceNumber = typeof input.invoiceNumber === "string" ? input.invoiceNumber.trim() : "";
  if (invoiceNumber.length > 80) return fail("The document number must be 80 characters or fewer.");
  const purchaseDate = String(input.purchaseDate ?? ""), dueDate = String(input.dueDate ?? "");
  if ((purchaseDate && !validDate(purchaseDate)) || (dueDate && !validDate(dueDate))) return fail("Check the purchase and due dates.");
  const subtotal = decimal(input.subtotal), vat = decimal(input.vat);
  if (Number.isNaN(subtotal) || Number.isNaN(vat)) return fail("Enter valid non-negative subtotal and VAT amounts, or leave them blank.");
  if (!Array.isArray(input.lines) || input.lines.length > 100) return fail("Use no more than 100 product lines per document.");
  const lines: InvoiceLine[] = [];
  for (const raw of input.lines) {
    if (!raw || typeof raw !== "object") return fail("Check the product rows.");
    const code = String(raw.code ?? "").trim(), description = String(raw.description ?? "").trim(), unit = String(raw.unit ?? "").trim();
    const quantity = decimal(raw.quantity), unitPrice = decimal(raw.unitPrice), net = decimal(raw.net);
    if ((!description && !code) || description.length > 240 || code.length > 60 || unit.length > 20 || [quantity,unitPrice,net].some(Number.isNaN) || quantity === 0) return fail("Each product needs a code or description and valid positive quantity / non-negative prices.");
    lines.push({code,description,unit,quantity,unitPrice,net:net == null ? null : roundMoney(net)});
  }
  return {ok:true,value:{documentType:input.documentType,invoiceNumber,purchaseDate,dueDate,currency:"GBP",subtotal:subtotal == null ? null : roundMoney(subtotal),vat:vat == null ? null : roundMoney(vat),lines}};
}
export function reconciliationWarnings(input: Pick<LedgerFields,"lines"|"subtotal"|"vat"> & {total:number|null}): string[] {
  const warnings:string[]=[];
  if (input.lines.some(l=>l.quantity!=null && l.unitPrice!=null && l.net!=null && Math.abs(roundMoney(l.quantity*l.unitPrice)-l.net)>.02)) warnings.push("A product's quantity × unit price differs from its line net. Check discounts and OCR.");
  if (input.lines.length && input.lines.every(l=>l.net!=null) && input.subtotal!=null && Math.abs(roundMoney(input.lines.reduce((n,l)=>n+(l.net??0),0))-input.subtotal)>.02) warnings.push("Product lines do not match the subtotal. Check missing rows, delivery and discounts.");
  if (input.subtotal!=null && input.vat!=null && input.total!=null && Math.abs(roundMoney(input.subtotal+input.vat)-input.total)>.02) warnings.push("Subtotal plus VAT does not match the total. Check charges and discounts.");
  if (!input.lines.length) warnings.push("No product lines captured. Add them if you need product-code history.");
  return warnings;
}
export function filterLedger(items: LedgerItem[], filter: {query?:string;from?:string;to?:string;supplier?:string;type?:string}) {
  const words=(filter.query??"").toLocaleLowerCase("en-GB").trim().split(/\s+/).filter(Boolean);
  return items.filter(i=>{
    if (filter.from && i.date<filter.from || filter.to && i.date>filter.to || filter.supplier && i.supplierName!==filter.supplier || filter.type && i.documentType!==filter.type) return false;
    const hay=[i.supplierName,i.supplierCode,i.invoiceNumber,i.filename,i.note,i.date,i.purchaseDate,i.bookingName,...i.lines.flatMap(l=>[l.code,l.description])].join(" ").toLocaleLowerCase("en-GB");
    return words.every(w=>hay.includes(w));
  });
}
export function ledgerTotals(items: LedgerItem[]) {
  const invoices=roundMoney(items.filter(i=>i.documentType!=="credit").reduce((n,i)=>n+i.total,0));
  const credits=roundMoney(items.filter(i=>i.documentType==="credit").reduce((n,i)=>n+i.total,0));
  const suppliers=new Map<string,number>(); const months=new Map<string,number>();
  for (const i of items) {const n=i.total*(i.documentType==="credit"?-1:1);suppliers.set(i.supplierName,roundMoney((suppliers.get(i.supplierName)??0)+n));const m=i.date.slice(0,7);months.set(m,roundMoney((months.get(m)??0)+n));}
  return {invoices,credits,net:roundMoney(invoices-credits),count:items.length,suppliers:[...suppliers].sort((a,b)=>b[1]-a[1]),months:[...months].sort((a,b)=>a[0].localeCompare(b[0]))};
}
