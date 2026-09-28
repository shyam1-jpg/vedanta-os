/** Night audit. Pure aggregation for the morning report. Food is never revenue. */

export type Tone = "red" | "amber" | "green";
export type Movement = "arrival" | "departure";

export type AuditStay = {
  name: string;
  firstName: string;
  room: string;
  party: number;
  returning: boolean;
  severe: boolean;
  access: boolean;
  movement: Movement;
};

export type AuditPayment = { kind: string; amount: number; note?: string | null };

export type AuditTicket = {
  number: string;
  title: string;
  priority: string;
  status: string;
  ageDays: number;
  location: string;
};

export type AuditIssue = { label: string; overdue: boolean };

export type AuditStock = { name: string; quantity: number; unit: string; low: number };

export type AuditTraining = { name: string; title: string; expiresOn: string };

export type AuditCompliance = { title: string; dueOn: string };

export type AuditNote = { author: string; department: string; shift: string; excerpt: string };

export type AuditDelivery = { supplier: string; detail: string };

export type NightAuditInput = {
  auditDate: string;
  tomorrow: string;
  stays: AuditStay[];
  occupiedRooms: number;
  availableRooms: number;
  payments: AuditPayment[];
  tickets: AuditTicket[];
  issues: AuditIssue[];
  stock: AuditStock[];
  training: AuditTraining[];
  compliance: AuditCompliance[];
  notes: AuditNote[];
  deliveries: AuditDelivery[];
};

export type AuditSection = {
  key: string;
  title: string;
  tone: Tone;
  summary: string;
  lines: string[];
};

export type Headline = { label: string; value: string; tone: Tone };

export type NightAuditReport = {
  auditDate: string;
  tomorrow: string;
  headline: Headline[];
  sections: AuditSection[];
  arrivals: AuditStay[];
  departures: AuditStay[];
  occupancy: { occupied: number; available: number; percent: number | null };
  revenue: { deposits: number; charges: number; refunds: number; net: number };
};

export type NightAuditSettings = { time: string; gmEmail: string; autoEmail: boolean };

export const NOTHING = "Nothing to report.";
export const DEFAULT_AUDIT_TIME = "23:30";
const FOOD = /food|meal|buffet|breakfast|lunch|dinner|restaurant/i;
const CHARGE_KINDS = new Set(["balance", "adjustment", "addon", "add-on", "add_on", "charge"]);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function daysUntil(due: string, today: string): number {
  const a = Date.parse(`${due}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((a - b) / 86_400_000);
}

function firstToken(value: string | null | undefined, fallback: string): string {
  const token = String(value ?? "").trim().split(/\s+/).filter(Boolean)[0];
  return token || fallback;
}

function pounds(n: number): string {
  return `£${n.toFixed(2)}`;
}

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

export function occupancyPercent(occupied: number, available: number): number | null {
  const rooms = Math.floor(Number(available));
  if (!Number.isFinite(rooms) || rooms <= 0) return null;
  const taken = Math.floor(Number(occupied));
  const n = Number.isFinite(taken) && taken > 0 ? taken : 0;
  return Math.round((n / rooms) * 100);
}

export function occupancyTone(percent: number | null): Tone {
  if (percent == null || percent < 80) return "green";
  if (percent >= 95) return "red";
  return "amber";
}

export function isFoodPayment(payment: AuditPayment): boolean {
  return FOOD.test(`${payment.kind ?? ""} ${payment.note ?? ""}`);
}

export function revenueFor(payments: AuditPayment[]): { deposits: number; charges: number; refunds: number; net: number } {
  let deposits = 0;
  let charges = 0;
  let refunds = 0;
  for (const payment of payments) {
    if (isFoodPayment(payment)) continue;
    const amount = Number(payment.amount);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const value = Math.abs(amount);
    const kind = String(payment.kind ?? "").trim().toLowerCase();
    if (kind === "deposit") deposits += value;
    else if (kind === "refund") refunds += value;
    else if (CHARGE_KINDS.has(kind)) charges += value;
  }
  deposits = money(deposits);
  charges = money(charges);
  refunds = money(refunds);
  return { deposits, charges, refunds, net: money(deposits + charges - refunds) };
}

function emailOrNull(value: unknown): string {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email || !email.includes("@") || /\s/.test(email) || email.length > 200) return "";
  return email;
}

export function parseNightAuditSettings(raw: unknown): NightAuditSettings {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const time = String(src.time ?? "").trim();
  const auto = src.auto_email ?? src.autoEmail;
  return {
    time: TIME.test(time) ? time : DEFAULT_AUDIT_TIME,
    gmEmail: emailOrNull(src.gm_email ?? src.gmEmail ?? src.manager),
    autoEmail: auto === true || auto === 1 || auto === "1" || auto === "true" || auto === "yes" || auto === "on",
  };
}

export function resolveGmEmail(settings: NightAuditSettings, fallback: string): string {
  return settings.gmEmail || emailOrNull(fallback);
}

/** The 15-minute job runs once the London clock has reached the configured time, and only if tonight has no snapshot yet. */
export function auditShouldRun(input: { londonTime: string; configured: string; already: boolean }): boolean {
  if (input.already) return false;
  const now = String(input.londonTime ?? "").slice(0, 5);
  const at = TIME.test(input.configured) ? input.configured : DEFAULT_AUDIT_TIME;
  return TIME.test(now) && now >= at;
}

export function severeAllergen(severity: string | null | undefined, detail: string | null | undefined): boolean {
  if (String(severity ?? "").toUpperCase() === "ANAPHYLAXIS") return true;
  return /anaphylaxis/i.test(String(detail ?? ""));
}

export function projectStay(raw: {
  givenName?: string | null;
  familyName?: string | null;
  groupName?: string | null;
  room?: string | null;
  party?: number | null;
  returning?: boolean;
  severity?: string | null;
  allergenDetail?: string | null;
  accessibility?: string | null;
  movement: Movement;
}): AuditStay {
  const given = String(raw.givenName ?? "").trim();
  const family = String(raw.familyName ?? "").trim();
  const group = String(raw.groupName ?? "").trim();
  const name = given ? `${given} ${family}`.trim() : firstToken(group, "Guest");
  const party = Math.round(Number(raw.party));
  return {
    name,
    firstName: firstToken(given || group, "Guest"),
    room: String(raw.room ?? "").trim() || "not assigned",
    party: Number.isFinite(party) && party > 0 ? party : 0,
    returning: !!raw.returning,
    severe: severeAllergen(raw.severity, raw.allergenDetail),
    access: String(raw.accessibility ?? "").trim().length > 0,
    movement: raw.movement,
  };
}

function section(key: string, title: string, tone: Tone, summary: string, lines: string[]): AuditSection {
  return { key, title, tone, summary, lines: lines.length ? lines : [NOTHING] };
}

function stayLine(stay: AuditStay): string {
  const bits = [`${stay.name} · room ${stay.room} · party ${stay.party}`];
  if (stay.returning) bits.push("returning");
  if (stay.severe) bits.push("severe allergen");
  if (stay.access) bits.push("accessibility");
  return bits.join(" · ");
}

function movementSection(arrivals: AuditStay[], departures: AuditStay[]): AuditSection {
  if (!arrivals.length && !departures.length) {
    return section("movements", "Arrivals and departures", "green", "Nothing tomorrow", []);
  }
  const lines = ["Arrivals", ...(arrivals.length ? arrivals.map(stayLine) : [NOTHING]), "Departures", ...(departures.length ? departures.map(stayLine) : [NOTHING])];
  const tone: Tone = arrivals.concat(departures).some(s => s.severe) ? "red" : arrivals.concat(departures).some(s => s.access) ? "amber" : "green";
  return section("movements", "Arrivals and departures", tone, `${arrivals.length} arriving · ${departures.length} departing`, lines);
}

function ticketTone(tickets: AuditTicket[]): Tone {
  if (!tickets.length) return "green";
  if (tickets.some(t => t.priority === "SAFETY" || t.priority === "URGENT" || t.ageDays >= 7)) return "red";
  return "amber";
}

function issueLabel(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (key === "food") return "Food note";
  if (key === "room") return "Room complaint";
  if (key === "staff") return "Staff note";
  if (key === "complaint") return "Guest complaint";
  if (key === "other" || !key) return "Guest note";
  return "Guest note";
}

export function buildNightAudit(input: NightAuditInput): NightAuditReport {
  const arrivals = input.stays.filter(s => s.movement === "arrival");
  const departures = input.stays.filter(s => s.movement === "departure");
  const movements = movementSection(arrivals, departures);

  const occupied = Math.max(0, Math.floor(Number(input.occupiedRooms) || 0));
  const available = Math.max(0, Math.floor(Number(input.availableRooms) || 0));
  const percent = occupancyPercent(occupied, available);
  const occTone = occupancyTone(percent);
  const occupancy = section(
    "occupancy",
    "Occupancy",
    occTone,
    percent == null ? "No guest rooms available" : `${percent}%`,
    percent == null ? [] : [`${occupied} of ${available} rooms · ${percent}%`],
  );

  const revenue = revenueFor(input.payments);
  const revenueEmpty = revenue.deposits === 0 && revenue.charges === 0 && revenue.refunds === 0;
  const revenueTone: Tone = revenue.refunds > 0 ? "amber" : "green";
  const revenueSection = section(
    "revenue",
    "Today's revenue",
    revenueEmpty ? "green" : revenueTone,
    revenueEmpty ? "Nothing received" : `Net ${pounds(revenue.net)}`,
    revenueEmpty ? [] : [`Deposits ${pounds(revenue.deposits)} · charges ${pounds(revenue.charges)} · refunds ${pounds(revenue.refunds)} · net ${pounds(revenue.net)}. Food is not counted.`],
  );

  const tickets = input.tickets;
  const maintenance = section(
    "maintenance",
    "Maintenance",
    ticketTone(tickets),
    tickets.length ? `${tickets.length} open` : "None open",
    tickets.map(t => `${t.number} · ${t.title} · ${t.priority} · ${t.status} · ${t.ageDays} days · ${t.location}`),
  );

  const issuesIn = input.issues.map(issue => ({ label: issueLabel(issue.label), overdue: !!issue.overdue }));
  const issues = section(
    "issues",
    "Guest issues",
    !issuesIn.length ? "green" : issuesIn.some(i => i.overdue) ? "red" : "amber",
    issuesIn.length ? `${issuesIn.length} open` : "None open",
    issuesIn.map(i => `${i.label}${i.overdue ? " · overdue" : " · open"}`),
  );

  const stockIn = input.stock.filter(item => Number(item.quantity) < Number(item.low));
  const stock = section(
    "stock",
    "Low stock",
    !stockIn.length ? "green" : stockIn.some(item => Number(item.quantity) <= 0) ? "red" : "amber",
    stockIn.length ? `${stockIn.length} low` : "Stock is fine",
    stockIn.map(item => `${item.name} · ${item.quantity} ${item.unit} · low at ${item.low}`),
  );

  const trainingIn = input.training
    .map(item => ({ ...item, days: daysUntil(item.expiresOn, input.auditDate), first: firstToken(item.name, "Staff") }))
    .filter(item => item.days >= 0 && item.days <= 30);
  const training = section(
    "training",
    "Training certificates",
    !trainingIn.length ? "green" : trainingIn.some(item => item.days <= 7) ? "red" : "amber",
    trainingIn.length ? `${trainingIn.length} due` : "None due",
    trainingIn.map(item => `${item.first} · ${item.title} · ${item.expiresOn} · ${item.days} days`),
  );

  const complianceIn = input.compliance
    .map(item => ({ ...item, days: daysUntil(item.dueOn, input.auditDate) }))
    .filter(item => item.days <= 7);
  const compliance = section(
    "compliance",
    "Compliance",
    !complianceIn.length ? "green" : complianceIn.some(item => item.days < 0) ? "red" : "amber",
    complianceIn.length ? `${complianceIn.length} due` : "None due",
    complianceIn.map(item => item.days < 0 ? `${item.title} · overdue ${Math.abs(item.days)} days` : `${item.title} · due ${item.dueOn} · ${item.days} days`),
  );

  const notes = input.notes.slice(0, 12).map(note => ({
    ...note,
    excerpt: String(note.excerpt ?? "").replace(/\s+/g, " ").trim().slice(0, 180),
  }));
  const handover = section(
    "handover",
    "Morning handover",
    notes.length ? "amber" : "green",
    notes.length ? `${notes.length} for the morning` : "None flagged",
    notes.map(note => `${note.shift} · ${note.department} · ${note.author} · ${note.excerpt}`),
  );

  const deliveries = section(
    "deliveries",
    "Expected deliveries",
    "green",
    input.deliveries.length ? `${input.deliveries.length} tomorrow` : "None expected",
    input.deliveries.map(item => `${item.supplier}${item.detail ? ` · ${item.detail}` : ""}`),
  );

  const sections = [movements, occupancy, revenueSection, maintenance, issues, stock, training, compliance, handover, deliveries];
  const headline: Headline[] = [
    { label: "Arrivals", value: String(arrivals.length), tone: arrivals.some(s => s.severe) ? "red" : arrivals.some(s => s.access) ? "amber" : "green" },
    { label: "Departures", value: String(departures.length), tone: departures.some(s => s.severe) ? "red" : departures.some(s => s.access) ? "amber" : "green" },
    { label: "Occupancy", value: percent == null ? "—" : `${percent}%`, tone: occTone },
    { label: "Revenue", value: revenueEmpty ? "—" : pounds(revenue.net), tone: revenueSection.tone },
    { label: "Maintenance", value: String(tickets.length), tone: maintenance.tone },
    { label: "Issues", value: String(issuesIn.length), tone: issues.tone },
    { label: "Low stock", value: String(stockIn.length), tone: stock.tone },
    { label: "Training", value: String(trainingIn.length), tone: training.tone },
    { label: "Compliance", value: String(complianceIn.length), tone: compliance.tone },
    { label: "Morning notes", value: String(notes.length), tone: handover.tone },
    { label: "Deliveries", value: String(input.deliveries.length), tone: "green" },
  ];

  return {
    auditDate: input.auditDate,
    tomorrow: input.tomorrow,
    headline,
    sections,
    arrivals,
    departures,
    occupancy: { occupied, available, percent },
    revenue,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderAuditHtml(report: NightAuditReport): string {
  const counts = report.headline.map(item =>
    `<li class="count"><i class="dot ${item.tone}"></i><b>${escapeHtml(item.value)}</b><span>${escapeHtml(item.label)}</span></li>`,
  ).join("");
  const sections = report.sections.map(item =>
    `<section data-section="${item.key}" data-tone="${item.tone}"><h2><i class="dot ${item.tone}"></i> ${escapeHtml(item.title)}</h2><p>${escapeHtml(item.summary)}</p><ul>${item.lines.map(line => `<li>${escapeHtml(line)}</li>`).join("")}</ul></section>`,
  ).join("");
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Night audit ${escapeHtml(report.auditDate)}</title><style>
body{margin:0;background:#F7F1E6;color:#1A1712;font-family:Georgia,serif}
h1,h2{font-weight:500}h1{font-size:1.4rem;margin:0}h2{font-size:1.1rem;margin:0 0 6px}
header,section{padding:16px}header{padding-bottom:0}
.counts{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:12px 16px;margin:0}
.count{flex:1 1 88px;background:#fff;border:1px solid #D9CFC0;padding:8px}
.count b{display:block;font-size:1.15rem}.count span{font-family:sans-serif;font-size:12px;color:#6A6258}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.red{background:#8A3B32}.amber{background:#C4A574}.green{background:#4F6758}
section{margin:0 12px 12px;background:#fff;border:1px solid #D9CFC0}
ul{padding-left:18px}li{margin:4px 0}
</style></head><body><header><h1>Night audit ${escapeHtml(report.auditDate)}</h1><p>For the morning of ${escapeHtml(report.tomorrow)}. Food is not counted.</p></header><ul class="counts">${counts}</ul>${sections}</body></html>`;
}

export function auditPdfLines(report: NightAuditReport): string[] {
  const lines = [`Night audit ${report.auditDate}`, `Morning of ${report.tomorrow}`, ""];
  for (const item of report.headline) lines.push(`${item.label}: ${item.value}`);
  lines.push("");
  for (const item of report.sections) {
    lines.push(item.title);
    for (const line of item.lines) lines.push(line);
    lines.push("");
  }
  return lines;
}

function escapePdf(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[^\x20-\x7E]/g, "?");
}

/** Multi-page text PDF. Guest-history exports stay on their own short renderer. */
export function textPdfPages(lines: string[]): string {
  const perPage = 46;
  const source = lines.length ? lines : ["Night audit"];
  const chunks: string[][] = [];
  for (let i = 0; i < source.length; i += perPage) chunks.push(source.slice(i, i + perPage));
  const fontId = 3 + chunks.length * 2;
  const objects: string[] = [];
  objects.push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj");
  objects.push(`2 0 obj << /Type /Pages /Count ${chunks.length} /Kids [${chunks.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] >> endobj`);
  chunks.forEach((chunk, i) => {
    const pageId = 3 + i * 2;
    const contentId = pageId + 1;
    const commands = ["BT", "/F1 11 Tf", "50 800 Td", "14 TL"];
    for (const line of chunk) commands.push(`(${escapePdf(line.slice(0, 110))}) Tj`, "T*");
    commands.push("ET");
    const stream = commands.join("\n");
    objects.push(`${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >> endobj`);
    objects.push(`${contentId} 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`);
  });
  objects.push(`${fontId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`);
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(body.length);
    body += `${obj}\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return body;
}

export function renderAuditPdf(report: NightAuditReport): string {
  return textPdfPages(auditPdfLines(report));
}

export function auditEmail(report: NightAuditReport): { subject: string; body: string } {
  const stay = (item: AuditStay) => `${item.firstName} · room ${item.room}`;
  const arrivals = report.arrivals.length ? report.arrivals.map(stay).join("\n") : NOTHING;
  const departures = report.departures.length ? report.departures.map(stay).join("\n") : NOTHING;
  const occ = report.occupancy.percent == null
    ? "No guest rooms available"
    : `${report.occupancy.percent}% (${report.occupancy.occupied} of ${report.occupancy.available})`;
  const moneyLine = report.revenue.deposits === 0 && report.revenue.charges === 0 && report.revenue.refunds === 0
    ? NOTHING
    : `Deposits ${pounds(report.revenue.deposits)}, charges ${pounds(report.revenue.charges)}, refunds ${pounds(report.revenue.refunds)}, net ${pounds(report.revenue.net)}.`;
  const training = report.sections.find(s => s.key === "training");
  const compliance = report.sections.find(s => s.key === "compliance");
  const deliveries = report.sections.find(s => s.key === "deliveries");
  const maintenance = report.sections.find(s => s.key === "maintenance");
  const issues = report.sections.find(s => s.key === "issues");
  const stock = report.sections.find(s => s.key === "stock");
  const notes = report.headline.find(item => item.label === "Morning notes")?.value ?? "0";
  const body = [
    `Night audit ${report.auditDate}`,
    "",
    "Arrivals",
    arrivals,
    "",
    "Departures",
    departures,
    "",
    `Occupancy: ${occ}`,
    `Revenue: ${moneyLine}`,
    "Food is not counted.",
    "",
    "Maintenance",
    ...(maintenance?.lines ?? [NOTHING]),
    "",
    "Guest issues",
    ...(issues?.lines ?? [NOTHING]),
    "",
    "Low stock",
    ...(stock?.lines ?? [NOTHING]),
    "",
    "Training",
    ...(training?.lines ?? [NOTHING]),
    "",
    "Compliance",
    ...(compliance?.lines ?? [NOTHING]),
    "",
    `Morning notes: ${notes}`,
    "",
    "Deliveries",
    ...(deliveries?.lines ?? [NOTHING]),
  ].join("\n");
  return { subject: `Night audit ${report.auditDate}`, body };
}

export function emptyAudit(auditDate: string, tomorrow: string): NightAuditReport {
  return buildNightAudit({
    auditDate,
    tomorrow,
    stays: [],
    occupiedRooms: 0,
    availableRooms: 0,
    payments: [],
    tickets: [],
    issues: [],
    stock: [],
    training: [],
    compliance: [],
    notes: [],
    deliveries: [],
  });
}
