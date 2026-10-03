import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { DEFAULT_SUPPLIERS } from "./back-office.ts";
import { parseInvoiceDataUrl, readInvoiceFile, textFromInvoiceBytes } from "./invoice-file.ts";
import {
  ACCOUNTS_NOT_CONNECTED,
  BLANK_TOTAL,
  BOOKED_INCOME_MISSING,
  INCOME_MISSING,
  NO_INVOICES_YET,
  confirmInvoice,
  invoiceSpendReport,
  readInvoiceFields,
} from "./invoice-spend.ts";

const suppliers = DEFAULT_SUPPLIERS;

function pdf(streamBody: string, deflate = false): Buffer {
  const raw = Buffer.from(streamBody, "latin1");
  const data = deflate ? deflateSync(raw) : raw;
  const filter = deflate ? "/Filter /FlateDecode " : "";
  const objects = [
    "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
    "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n",
    "3 0 obj<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>endobj\n",
    `4 0 obj<< ${filter}/Length ${data.length} >>stream\n${data.toString("latin1")}\nendstream\nendobj\n`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(body.length);
    body += obj;
  }
  const xref = body.length;
  let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) table += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  body += `${table}trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body, "latin1");
}

describe("readInvoiceFields", () => {
  it("reads a labelled supplier, date and total", () => {
    const read = readInvoiceFields("Supplier: Suma\nInvoice date: 02/10/2026\nTotal £48.20\nSubtotal £40.00", suppliers);
    assert.equal(read.supplierCode, "SUMA");
    assert.equal(read.supplierName, "Suma");
    assert.equal(read.date, "2026-10-02");
    assert.equal(read.total, 48.2);
  });

  it("keeps the total blank when labels disagree or only a subtotal is present", () => {
    assert.equal(readInvoiceFields("Subtotal 12.00\nVAT 2.40\nOrder 44021", suppliers).total, null);
    assert.equal(readInvoiceFields("Total £10.00\nAmount due £12.50", suppliers).total, null);
    assert.equal(readInvoiceFields("Total VAT £2.00", suppliers).total, null);
  });

  it("does not use a due date as the invoice date", () => {
    assert.equal(readInvoiceFields("Due date: 01/11/2026\nDelivery date: 02/10/2026", suppliers).date, null);
    assert.equal(readInvoiceFields("Invoice date: 02/10/2026\nDue date: 01/11/2026", suppliers).date, "2026-10-02");
    assert.equal(readInvoiceFields("Invoice date: 02/10/2026\nInvoice date: 03/10/2026", suppliers).date, null);
  });

  it("leaves the supplier blank when none is written or more than one shop is named", () => {
    assert.equal(readInvoiceFields("Please pay this invoice", suppliers).supplierName, null);
    assert.equal(readInvoiceFields("Suma and Breaks", suppliers).supplierName, null);
    const local = readInvoiceFields("Supplier: Lincoln wholefoods", suppliers);
    assert.equal(local.localShop, true);
    assert.equal(local.supplierName, "Lincoln wholefoods");
    assert.equal(local.supplierCode, null);
    assert.equal(readInvoiceFields("Fresh from the Field", suppliers).supplierCode, "FRESH_FIELD");
    assert.equal(readInvoiceFields("Sainsbury's", suppliers).supplierName, "Sainsbury's");
  });

  it("reads a text PDF and leaves an image blank", () => {
    const stream = "BT (Invoice date: 02/10/2026) Tj (Supplier: Suma) Tj (Total £48.20) Tj ET";
    const plain = readInvoiceFile("application/pdf", pdf(stream), suppliers);
    assert.equal(plain.supplierCode, "SUMA");
    assert.equal(plain.date, "2026-10-02");
    assert.equal(plain.total, 48.2);
    const packed = readInvoiceFile("application/pdf", pdf(stream, true), suppliers);
    assert.equal(packed.total, 48.2);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22, 0x33, 0x44]);
    assert.equal(textFromInvoiceBytes("image/jpeg", jpeg), "");
    const image = readInvoiceFile("image/jpeg", jpeg, suppliers);
    assert.equal(image.supplierName, null);
    assert.equal(image.date, null);
    assert.equal(image.total, null);
    const url = `data:application/pdf;base64,${pdf(stream).toString("base64")}`;
    const parsed = parseInvoiceDataUrl(url);
    assert.equal(parsed.ok, true);
    assert.equal(parseInvoiceDataUrl(`data:application/pdf;base64,${jpeg.toString("base64")}`).ok, false);
  });
});

describe("confirmInvoice", () => {
  it("refuses a blank total even when a file could have held one", () => {
    const refused = confirmInvoice({ invoiceDate: "2026-10-02", total: null, supplierCode: "SUMA", note: "" });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.error, BLANK_TOTAL);
    assert.equal(confirmInvoice({ invoiceDate: "2026-10-02", total: 0, supplierCode: "SUMA" }).ok, false);
    const saved = confirmInvoice({ invoiceDate: "2026-10-02", total: 48.2, supplierCode: "SUMA", note: "oats" });
    assert.equal(saved.ok, true);
    if (saved.ok) assert.equal(saved.total, 48.2);
    const eggs = confirmInvoice({ invoiceDate: "2026-10-02", total: 4, supplierCode: "SUMA", note: "eggs" });
    assert.equal(eggs.ok, false);
  });
});

describe("invoiceSpendReport", () => {
  const invoices = [
    { date: "2026-10-02", amount: 10, bookingId: null, bookingName: null },
    { date: "2026-10-03", amount: 5, bookingId: "booking-1", bookingName: "Quiet Week" },
  ];
  const booked = [
    { id: "booking-1", name: "Quiet Week", arrival: "2026-10-01", departure: "2026-10-08", booked: 100 },
    { id: "booking-2", name: "Open Week", arrival: "2026-10-05", departure: "2026-10-09", booked: null },
  ];

  it("shows an empty state and no figures when nothing is attached", () => {
    const empty = invoiceSpendReport({ anchor: "2026-10-02", invoices: [], income: [{ date: "2026-10-02", amount: 40 }], booked });
    assert.deepEqual(empty, { empty: true, message: NO_INVOICES_YET, accounts: ACCOUNTS_NOT_CONNECTED });
    assert.equal(/\d/.test(JSON.stringify(empty)), false);
  });

  it("totals real spend and leaves income or booked income missing when they are not stored", () => {
    const report = invoiceSpendReport({ anchor: "2026-10-02", invoices, income: null, booked: booked.map(stay => ({ ...stay, booked: null })) });
    assert.equal(report.empty, false);
    if (report.empty) return;
    assert.equal(report.periods.day.spend, 10);
    assert.equal(report.periods.week.spend, 15);
    assert.equal(report.periods.month.spend, 15);
    assert.equal(report.periods.year.spend, 15);
    assert.equal(report.periods.year.income, null);
    assert.equal(report.periods.year.pnlMessage, INCOME_MISSING);
    assert.equal(report.periods.year.profit, null);
    assert.equal(report.periods.year.forecast, null);
    assert.equal(report.periods.year.forecastMessage, BOOKED_INCOME_MISSING);
    assert.equal(report.retreats.find(row => row.bookingId == null)?.name, "Unassigned");
    assert.equal(report.retreats.find(row => row.bookingId == null)?.spend, 10);
    assert.equal(report.retreats.find(row => row.bookingId === "booking-1")?.spend, 5);
    assert.equal(report.retreats.reduce((n, row) => n + row.spend, 0), report.periods.year.spend);
    assert.equal(report.chart.points.length, 12);
    assert.equal(report.chart.points[9].spend, 15);
    assert.equal(report.chart.hasSpend, true);
  });

  it("compares stored income and booked income with recorded spend", () => {
    const report = invoiceSpendReport({
      anchor: "2026-10-02",
      invoices,
      income: [{ date: "2026-10-02", amount: 40 }],
      booked,
    });
    assert.equal(report.empty, false);
    if (report.empty) return;
    assert.equal(report.periods.day.profit, 30);
    assert.equal(report.periods.day.outcome, "profit");
    assert.equal(report.periods.week.profit, 25);
    assert.equal(report.periods.day.forecast, null);
    assert.equal(report.periods.day.forecastMessage, BOOKED_INCOME_MISSING);
    assert.equal(report.periods.week.forecast, 85);
    assert.equal(report.periods.week.forecastOutcome, "profit");
    assert.equal(report.periods.month.bookingsLeftOut, 1);
    assert.match(report.periods.month.forecastMessage, /left out/);
    const loss = invoiceSpendReport({
      anchor: "2026-10-02",
      invoices,
      income: [{ date: "2026-10-02", amount: 4 }],
      booked: [],
    });
    assert.equal(loss.empty, false);
    if (!loss.empty) {
      assert.equal(loss.periods.day.outcome, "loss");
      assert.equal(loss.periods.day.profit, -6);
    }
  });
});
