import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NOTHING,
  auditEmail,
  auditShouldRun,
  buildNightAudit,
  emptyAudit,
  occupancyPercent,
  occupancyTone,
  parseNightAuditSettings,
  projectStay,
  renderAuditHtml,
  renderAuditPdf,
  resolveGmEmail,
  revenueFor,
  textPdfPages,
  type NightAuditInput,
} from "./nightAudit.ts";

const TODAY = "2026-09-28";
const TOMORROW = "2026-09-29";

function input(over: Partial<NightAuditInput> = {}): NightAuditInput {
  return {
    auditDate: TODAY,
    tomorrow: TOMORROW,
    stays: [],
    occupiedRooms: 0,
    availableRooms: 25,
    payments: [],
    tickets: [],
    issues: [],
    stock: [],
    training: [],
    compliance: [],
    notes: [],
    deliveries: [],
    ...over,
  };
}

describe("occupancy", () => {
  it("is occupied rooms out of available rooms, as a whole percent", () => {
    assert.equal(occupancyPercent(18, 25), 72);
    assert.equal(occupancyPercent(0, 10), 0);
    assert.equal(occupancyPercent(1, 3), 33);
  });

  it("is empty when there are no available rooms, and can pass 100", () => {
    assert.equal(occupancyPercent(4, 0), null);
    assert.equal(occupancyPercent(4, -2), null);
    assert.equal(occupancyPercent(12, 10), 120);
  });

  it("uses green under 80, amber from 80 to 94, and red from 95", () => {
    assert.equal(occupancyTone(79), "green");
    assert.equal(occupancyTone(0), "green");
    assert.equal(occupancyTone(null), "green");
    assert.equal(occupancyTone(80), "amber");
    assert.equal(occupancyTone(94), "amber");
    assert.equal(occupancyTone(95), "red");
    assert.equal(occupancyTone(120), "red");
  });
});

describe("revenue", () => {
  it("counts deposits, add-ons and other charges, and refunds, and leaves food out", () => {
    const totals = revenueFor([
      { kind: "deposit", amount: 200 },
      { kind: "addon", amount: 40, note: "lunch buffet" },
      { kind: "charge", amount: 15, note: "spa" },
      { kind: "balance", amount: 10 },
      { kind: "adjustment", amount: 5 },
      { kind: "refund", amount: 8, note: "breakfast refund" },
      { kind: "refund", amount: 12, note: "room" },
      { kind: "writeoff", amount: 100 },
      { kind: "food", amount: 50 },
      { kind: "deposit", amount: 20, note: "Food package" },
    ]);
    assert.deepEqual(totals, { deposits: 200, charges: 30, refunds: 12, net: 218 });
    assert.doesNotMatch(JSON.stringify(totals), /buffet|breakfast|food|lunch/i);
  });

  it("treats a day of only buffet charges as no revenue", () => {
    const report = buildNightAudit(input({
      payments: [{ kind: "charge", amount: 40, note: "dinner buffet" }],
    }));
    const section = report.sections.find(s => s.key === "revenue");
    assert.equal(section?.lines[0], NOTHING);
    assert.equal(section?.tone, "green");
    assert.equal(report.revenue.net, 0);
    assert.doesNotMatch(JSON.stringify(report), /buffet|dinner/i);
  });

  it("marks refunds amber and a quiet day green", () => {
    const quiet = buildNightAudit(input({ payments: [{ kind: "deposit", amount: 200 }] }));
    const refunded = buildNightAudit(input({ payments: [{ kind: "deposit", amount: 200 }, { kind: "refund", amount: 20, note: "deposit" }] }));
    assert.equal(quiet.sections.find(s => s.key === "revenue")?.tone, "green");
    assert.equal(refunded.sections.find(s => s.key === "revenue")?.tone, "amber");
    assert.equal(refunded.revenue.net, 180);
  });
});

describe("each section", () => {
  const report = buildNightAudit(input({
    stays: [
      projectStay({ givenName: "Anika", familyName: "Sharma", room: "4", party: 6, returning: true, severity: "ANAPHYLAXIS", allergenDetail: "peanut", accessibility: "ground floor", movement: "arrival" }),
      projectStay({ groupName: "Quiet day retreat", room: "Hall", party: 12, movement: "arrival" }),
      projectStay({ groupName: "Quiet day retreat", room: "Hall", party: 12, movement: "departure" }),
    ],
    occupiedRooms: 20,
    availableRooms: 25,
    payments: [{ kind: "deposit", amount: 200 }, { kind: "charge", amount: 30, note: "spa" }],
    tickets: [
      { number: "M-4", title: "Boiler", priority: "SAFETY", status: "OPEN", ageDays: 2, location: "Plant room" },
      { number: "M-9", title: "Dripping tap", priority: "LOW", status: "OPEN", ageDays: 1, location: "Room 2" },
    ],
    issues: [{ label: "food", overdue: false }, { label: "room", overdue: true }],
    stock: [{ name: "Rice", quantity: 0, unit: "kg", low: 5 }, { name: "Tea", quantity: 8, unit: "box", low: 2 }],
    training: [
      { name: "Priya Nair", title: "Fire marshal", expiresOn: "2026-10-04" },
      { name: "Owen", title: "First aid", expiresOn: "2026-12-01" },
    ],
    compliance: [
      { title: "Fire alarm test", dueOn: "2026-09-25" },
      { title: "Insurance renewal", dueOn: "2026-11-01" },
    ],
    notes: [{ author: "Night", department: "FRONT", shift: "night", excerpt: "Early taxi for the hall group." }],
    deliveries: [{ supplier: "Green Grocer", detail: "vegetables" }],
  }));

  it("keeps the sections in the morning order", () => {
    assert.deepEqual(report.sections.map(s => s.key), [
      "movements", "occupancy", "revenue", "maintenance", "issues", "stock", "training", "compliance", "handover", "deliveries",
    ]);
  });

  it("lists tomorrow's arrivals and departures with flags and without allergen detail", () => {
    const moves = report.sections.find(s => s.key === "movements");
    assert.equal(report.arrivals.length, 2);
    assert.equal(report.departures.length, 1);
    assert.match(moves?.lines.join("\n") ?? "", /Anika Sharma · room 4 · party 6 · returning · severe allergen · accessibility/);
    assert.match(moves?.lines.join("\n") ?? "", /Quiet · room Hall · party 12/);
    assert.equal(moves?.tone, "red");
    assert.doesNotMatch(JSON.stringify(report), /peanut|ground floor/i);
  });

  it("turns a severe flag on from the word in the detail without copying that detail", () => {
    const stay = projectStay({ groupName: "Lee party", allergenDetail: "peanut ANAPHYLAXIS", movement: "arrival" });
    assert.equal(stay.severe, true);
    assert.equal(stay.access, false);
    assert.doesNotMatch(JSON.stringify(stay), /peanut/i);
  });

  it("counts occupancy, open maintenance, issues, stock, training, compliance, notes and deliveries", () => {
    assert.equal(report.occupancy.percent, 80);
    assert.equal(report.sections.find(s => s.key === "occupancy")?.tone, "amber");
    assert.equal(report.sections.find(s => s.key === "maintenance")?.tone, "red");
    assert.match(report.sections.find(s => s.key === "issues")?.lines.join(" ") ?? "", /Food note · open/);
    assert.match(report.sections.find(s => s.key === "issues")?.lines.join(" ") ?? "", /Room complaint · overdue/);
    assert.equal(report.sections.find(s => s.key === "issues")?.tone, "red");
    assert.equal(report.sections.find(s => s.key === "stock")?.lines.length, 1);
    assert.match(report.sections.find(s => s.key === "stock")?.lines[0] ?? "", /Rice/);
    assert.equal(report.sections.find(s => s.key === "stock")?.tone, "red");
    assert.match(report.sections.find(s => s.key === "training")?.lines[0] ?? "", /^Priya · Fire marshal/);
    assert.equal(report.sections.find(s => s.key === "training")?.lines.length, 1);
    assert.equal(report.sections.find(s => s.key === "training")?.tone, "red");
    assert.match(report.sections.find(s => s.key === "compliance")?.lines[0] ?? "", /Fire alarm test · overdue/);
    assert.equal(report.sections.find(s => s.key === "compliance")?.lines.length, 1);
    assert.equal(report.headline.find(h => h.label === "Morning notes")?.value, "1");
    assert.equal(report.headline.find(h => h.label === "Deliveries")?.value, "1");
    assert.equal(report.revenue.net, 230);
  });

  it("marks an ageing ticket and a low-but-present stock line", () => {
    const aged = buildNightAudit(input({
      tickets: [{ number: "M-1", title: "Fence", priority: "LOW", status: "OPEN", ageDays: 7, location: "Drive" }],
      stock: [{ name: "Oats", quantity: 1, unit: "kg", low: 4 }],
      training: [{ name: "Owen Cole", title: "Allergen awareness", expiresOn: "2026-10-20" }],
      compliance: [{ title: "Fridge calibration", dueOn: "2026-10-01" }],
    }));
    assert.equal(aged.sections.find(s => s.key === "maintenance")?.tone, "red");
    assert.equal(aged.sections.find(s => s.key === "stock")?.tone, "amber");
    assert.equal(aged.sections.find(s => s.key === "training")?.tone, "amber");
    assert.match(aged.sections.find(s => s.key === "training")?.lines[0] ?? "", /^Owen ·/);
    assert.doesNotMatch(aged.sections.find(s => s.key === "training")?.lines[0] ?? "", /Cole/);
    assert.equal(aged.sections.find(s => s.key === "compliance")?.tone, "amber");
  });
});

describe("empty modules", () => {
  it("gives every section a calm empty line", () => {
    const report = emptyAudit(TODAY, TOMORROW);
    assert.equal(report.sections.length, 10);
    for (const item of report.sections) {
      assert.equal(item.lines[0], NOTHING);
      assert.equal(item.tone, "green");
    }
    assert.equal(report.occupancy.percent, null);
    assert.equal(report.headline.find(h => h.label === "Occupancy")?.value, "—");
    const html = renderAuditHtml(report);
    assert.equal(html.split(NOTHING).length - 1, 10);
    const keys = [...html.matchAll(/data-section="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(keys, report.sections.map(s => s.key));
  });
});

describe("schedule and letter", () => {
  it("defaults to 23:30 London, with automatic email off", () => {
    assert.deepEqual(parseNightAuditSettings(undefined), { time: "23:30", gmEmail: "", autoEmail: false });
    assert.deepEqual(parseNightAuditSettings({ time: "25:99", auto_email: "yes", gm_email: " GM@Example.invalid " }), {
      time: "23:30", gmEmail: "gm@example.invalid", autoEmail: true,
    });
    assert.equal(resolveGmEmail(parseNightAuditSettings({}), "desk@example.invalid"), "desk@example.invalid");
    assert.equal(resolveGmEmail(parseNightAuditSettings({ gm_email: "gm@example.invalid" }), "desk@example.invalid"), "gm@example.invalid");
  });

  it("runs once the clock has passed the configured time, and not again the same night", () => {
    assert.equal(auditShouldRun({ londonTime: "23:15", configured: "23:30", already: false }), false);
    assert.equal(auditShouldRun({ londonTime: "23:30", configured: "23:30", already: false }), true);
    assert.equal(auditShouldRun({ londonTime: "23:45:10", configured: "23:30", already: false }), true);
    assert.equal(auditShouldRun({ londonTime: "23:45", configured: "23:30", already: true }), false);
    assert.equal(auditShouldRun({ londonTime: "00:10", configured: "bad", already: false }), false);
  });

  it("emails first names and room numbers, and leaves health data and the handover body out", () => {
    const report = buildNightAudit(input({
      stays: [projectStay({
        givenName: "Anika", familyName: "Sharma", room: "4", party: 6, returning: true,
        severity: "ANAPHYLAXIS", allergenDetail: "sesame", accessibility: "step-free room", movement: "arrival",
      })],
      payments: [{ kind: "deposit", amount: 200 }, { kind: "addon", amount: 40, note: "lunch buffet" }],
      notes: [{ author: "Night", department: "FRONT", shift: "night", excerpt: "Guest asked for a peanut-free plate." }],
      training: [{ name: "Priya Nair", title: "Fire marshal", expiresOn: "2026-10-04" }],
    }));
    const letter = auditEmail(report);
    assert.match(letter.subject, /2026-09-28/);
    assert.match(letter.body, /Anika · room 4/);
    assert.match(letter.body, /Morning notes: 1/);
    assert.match(letter.body, /Priya · Fire marshal/);
    assert.match(letter.body, /Food is not counted/);
    assert.equal(letter.body.includes("Sharma"), false);
    assert.equal(letter.body.includes("party"), false);
    assert.doesNotMatch(letter.body, /peanut|sesame|anaphyl|severe|accessibility|buffet|lunch|step-free/i);
    const pdf = renderAuditPdf(report);
    assert.match(pdf, /^%PDF-1\.4/);
    assert.match(pdf, /Anika Sharma/);
    assert.match(pdf, /severe allergen/);
    assert.doesNotMatch(pdf, /sesame|step-free/);
  });

  it("splits a long report across pages", () => {
    const pdf = textPdfPages(Array.from({ length: 100 }, (_, i) => `Line ${i}`));
    assert.match(pdf, /\/Count 3/);
    assert.match(pdf, /%%EOF/);
  });
});
