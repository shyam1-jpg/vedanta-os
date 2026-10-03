/**
 * Staff attach an invoice file, confirm what was read, then it counts as spend.
 * The file is not saved as spend until the person confirms a total.
 * Sage, Xero, Payday and Hotelkit are not called.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { pool } from "./db.ts";
import { requireActor, problem, type Actor } from "./auth.ts";
import { DEFAULT_SUPPLIERS } from "../../../domains/finance/back-office.ts";
import { parseInvoiceDataUrl, readInvoiceFile } from "../../../domains/finance/invoice-file.ts";
import {
  confirmInvoice,
  incomeLedgerNote,
  invoiceSpendReport,
  type BookedStay,
  type SavedInvoice,
  type StoredIncome,
} from "../../../domains/finance/invoice-spend.ts";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BODY = { bodyLimit: 8_000_000 };

function canRead(a: Actor, reply: FastifyReply): boolean {
  if (a.perms.has("group.read") || a.perms.has("report.read")) return true;
  reply.code(403).send(problem(403, "forbidden", "You cannot read invoices."));
  return false;
}

function pounds(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function cleanName(name: unknown): string {
  const base = String(name ?? "invoice").split(/[/\\]/).pop() ?? "invoice";
  const clean = base.replace(/[^\w.\- ()]+/g, "").trim().slice(0, 120);
  return clean || "invoice";
}

async function londonToday(): Promise<string> {
  const r = await pool.query(`select (timezone('Europe/London', now()))::date::text t`);
  return r.rows[0].t as string;
}

export default async function invoiceAttachments(f: FastifyInstance) {
  f.get("/v1/invoice-attachments/spend", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !canRead(a, reply)) return;
    const today = await londonToday();
    const anchor = DATE.test(req.query?.anchor ?? "") ? req.query.anchor : today;

    const [invoiceR, incomeR, paymentR, bookingR] = await Promise.all([
      pool.query(`select a.id, a.filename, a.invoice_date::text as date, a.total, a.supplier_code, a.supplier_name,
          a.local_shop, a.booking_id, a.note, g.name as booking_name
        from invoice_attachment a
        left join booking_group g on g.id = a.booking_id and g.property_id = a.property_id
        where a.property_id = $1
        order by a.invoice_date desc, a.created_at desc`, [a.propertyId]),
      pool.query(`select received_on::text as date, amount from retreat_income where property_id = $1`, [a.propertyId]),
      pool.query(`select (timezone('Europe/London', p.paid_at))::date::text as date, p.amount
        from payment p
        join folio f on f.id = p.folio_id
        where f.property_id = $1 and p.paid_at is not null and p.kind not in ('refund', 'writeoff')`, [a.propertyId]),
      pool.query(`select g.id, g.name, g.status, g.arrival_date::text as arrival, g.departure_date::text as departure,
          coalesce(
            (select f.total_agreed from folio f where f.group_id = g.id and f.total_agreed is not null order by f.updated_at desc nulls last limit 1),
            g.agreed_total
          ) as booked
        from booking_group g
        where g.property_id = $1
        order by g.arrival_date desc nulls last, g.name`, [a.propertyId]),
    ]);

    const invoices: SavedInvoice[] = invoiceR.rows.map((row: { date: string; total: string; booking_id: string | null; booking_name: string | null }) => ({
      date: row.date,
      amount: Number(row.total),
      bookingId: row.booking_id,
      bookingName: row.booking_name,
    }));
    let income: StoredIncome[] | null = null;
    let incomeSource: "retreat_income" | "folio_payments" | null = null;
    if (incomeR.rowCount) {
      income = incomeR.rows.map((row: { date: string; amount: string }) => ({ date: row.date, amount: Number(row.amount) }));
      incomeSource = "retreat_income";
    } else if (paymentR.rowCount) {
      income = paymentR.rows.map((row: { date: string; amount: string }) => ({ date: row.date, amount: Number(row.amount) }));
      incomeSource = "folio_payments";
    }
    const booked: BookedStay[] = bookingR.rows.map((row: { id: string; name: string; arrival: string | null; departure: string | null; booked: string | null }) => ({
      id: row.id,
      name: row.name,
      arrival: row.arrival,
      departure: row.departure,
      booked: row.booked == null ? null : Number(row.booked),
    }));
    const report = invoiceSpendReport({ anchor, invoices, income, booked });
    const localShops = [...new Set(invoiceR.rows.filter((row: { local_shop: boolean }) => row.local_shop).map((row: { supplier_name: string }) => row.supplier_name))].sort((a, b) => a.localeCompare(b, "en-GB"));
    return {
      ...report,
      incomeNote: report.empty ? null : incomeLedgerNote(incomeSource),
      anchor: report.empty ? anchor : report.anchor,
      items: invoiceR.rows.slice(0, 100).map((row: any) => ({
        id: row.id,
        filename: row.filename,
        date: row.date,
        total: Number(row.total),
        supplierName: row.supplier_name,
        supplierCode: row.supplier_code,
        localShop: row.local_shop,
        bookingId: row.booking_id,
        bookingName: row.booking_name,
        note: row.note,
      })),
      retreatsOnBook: bookingR.rows.map((row: { id: string; name: string; status: string; arrival: string | null; departure: string | null }) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        arrival: row.arrival,
        departure: row.departure,
      })),
      localShops,
    };
  });

  f.post("/v1/invoice-attachments/read", BODY, async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !canRead(a, reply)) return;
    const file = parseInvoiceDataUrl(String(req.body?.data ?? ""));
    if (!file.ok) return reply.code(422).send(problem(422, "validation", file.error));
    return readInvoiceFile(file.mime, file.bytes, DEFAULT_SUPPLIERS);
  });

  f.post("/v1/invoice-attachments", BODY, async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !canRead(a, reply)) return;
    const file = parseInvoiceDataUrl(String(req.body?.data ?? ""));
    if (!file.ok) return reply.code(422).send(problem(422, "validation", file.error));
    // The saved total is the figure the person submitted. The file is not read again to fill a blank.
    const confirmed = confirmInvoice({
      invoiceDate: String(req.body?.invoiceDate ?? ""),
      total: pounds(req.body?.total),
      supplierCode: req.body?.supplierCode,
      localName: req.body?.localName,
      note: req.body?.note,
    });
    if (!confirmed.ok) return reply.code(422).send(problem(422, "validation", confirmed.error));
    let bookingId: string | null = null;
    const rawBooking = String(req.body?.bookingId ?? "").trim();
    if (rawBooking) {
      if (!UUID.test(rawBooking)) return reply.code(422).send(problem(422, "validation", "Choose a retreat from the board, or leave it unassigned."));
      const found = await pool.query(`select id from booking_group where id=$1 and property_id=$2`, [rawBooking, a.propertyId]);
      if (!found.rowCount) return reply.code(404).send(problem(404, "not_found", "That retreat is not on the board."));
      bookingId = rawBooking;
    }
    const dataUrl = String(req.body.data);
    const saved = await pool.query(`insert into invoice_attachment
      (tenant_id, property_id, filename, mime, file_data, supplier_code, supplier_name, local_shop, invoice_date, total, booking_id, note, entered_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
      [a.tenantId, a.propertyId, cleanName(req.body?.filename), file.mime, dataUrl, confirmed.code, confirmed.name, confirmed.local, confirmed.date, confirmed.total, bookingId, confirmed.note, a.userId]);
    return { id: saved.rows[0].id };
  });

  f.get("/v1/invoice-attachments/:id", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !canRead(a, reply)) return;
    if (!UUID.test(req.params.id)) return reply.code(422).send(problem(422, "validation", "That invoice was not found."));
    const row = (await pool.query(`select filename, mime, file_data from invoice_attachment where id=$1 and property_id=$2`, [req.params.id, a.propertyId])).rows[0];
    if (!row) return reply.code(404).send(problem(404, "not_found", "That invoice was not found."));
    return { filename: row.filename, mime: row.mime, data: row.file_data };
  });
}
