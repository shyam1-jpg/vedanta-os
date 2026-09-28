/** Daily briefing. A rules scorer, not a model. Points are house settings. */

import { NOTHING, type Tone } from "./nightAudit.ts";

export { NOTHING };

export type BriefingView = "kitchen" | "house";
export type WatchRule = "severe" | "cold" | "vip" | "compliance" | "staffing";
export type Movement = "arrival" | "departure" | "in_house";

export type BriefingStay = {
  id: string;
  firstName: string;
  room: string;
  party: number;
  movement: Movement;
  returning: boolean;
  severe: boolean;
  access: boolean;
  vip: boolean;
  flagged: boolean;
  allergens: string[];
};

export type BriefingShift = {
  id: string;
  userId: string;
  department: string;
  firstName: string;
  start: string;
  end: string;
  swapped: boolean;
};

export type BriefingTicket = {
  id: string;
  number: string;
  title: string;
  priority: string;
  status: string;
  ageDays: number;
  location: string;
};

export type BriefingIssue = { id: string; label: string; overdue: boolean };
export type BriefingStock = { id: string; name: string; quantity: number; unit: string; low: number };
export type BriefingCompliance = { id: string; title: string; dueOn: string };
export type BriefingTraining = { id: string; firstName: string; title: string; expiresOn: string };
export type BriefingDelivery = { id: string; supplier: string; detail: string };
export type BriefingNote = { id: string; author: string; department: string; shift: string; excerpt: string; ackedBy: string[] };

export type BriefingFacts = {
  date: string;
  stays: BriefingStay[];
  shifts: BriefingShift[];
  shiftsKnown: boolean;
  tickets: BriefingTicket[];
  issues: BriefingIssue[];
  stock: BriefingStock[];
  compliance: BriefingCompliance[];
  training: BriefingTraining[];
  deliveries: BriefingDelivery[];
  notes: BriefingNote[];
};

export type WatchRules = {
  severe: number;
  cold: number;
  vip: number;
  compliance: number;
  staffing: number;
  heads: Record<string, number>;
};

export type Mark = { key: string; action: "pin" | "dismiss" };

export type WatchItem = {
  key: string;
  rule: WatchRule;
  points: number;
  why: string;
  title: string;
  href: string;
  pinned: boolean;
};

export type BriefingLine = { key: string; text: string; href: string };

export type BriefingSection = {
  key: string;
  title: string;
  tone: Tone;
  summary: string;
  href: string;
  lines: BriefingLine[];
};

export type BriefingBoard = {
  date: string;
  view: BriefingView;
  watch: WatchItem[];
  held: WatchItem[];
  sections: BriefingSection[];
};

export const BRIEFING_LINKS = {
  stays: "/groups/",
  shifts: "/hr/",
  tickets: "/maintenance/",
  stock: "/stock/",
  issues: "/feedback/",
  compliance: "/compliance/",
  training: "/training/",
  deliveries: "/suppliers/",
  notes: "/ops/",
  guests: "/guest-360/",
} as const;

export const DEFAULT_HEADS: Record<string, number> = { KITCHEN: 2, FRONT: 1 };

export const DEFAULT_RULES: WatchRules = {
  severe: 100,
  cold: 90,
  vip: 80,
  compliance: 70,
  staffing: 60,
  heads: { ...DEFAULT_HEADS },
};

const KITCHEN_ROLES = new Set([
  "HEAD_CHEF", "KITCHEN_MANAGER", "SOUS_CHEF", "SENIOR_CHEF_DE_PARTIE",
  "CHEF_DE_PARTIE", "KITCHEN_APPRENTICE", "KITCHEN_ASSISTANT", "KITCHEN_PORTER", "KITCHEN",
]);

const COLD = /fridge|freezer|walk-?in|cold/i;

export function briefingView(input: { role: string; department?: string | null; perms?: Iterable<string> }): BriefingView {
  const perms = new Set(input.perms ?? []);
  if (perms.has("guest.profile.kitchen")) return "kitchen";
  if (KITCHEN_ROLES.has(String(input.role ?? "").toUpperCase())) return "kitchen";
  if (String(input.department ?? "").toUpperCase() === "KITCHEN") return "kitchen";
  return "house";
}

function points(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1000) return fallback;
  return Math.round(n);
}

export function parseWatchRules(raw: unknown): WatchRules {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const headsRaw = src.heads && typeof src.heads === "object" ? src.heads as Record<string, unknown> : {};
  const heads: Record<string, number> = {};
  const merged = { ...DEFAULT_HEADS, ...headsRaw };
  for (const [key, value] of Object.entries(merged)) {
    const name = key.trim().toUpperCase();
    if (!name) continue;
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 0 || n > 99) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_HEADS, name)) heads[name] = DEFAULT_HEADS[name];
      continue;
    }
    heads[name] = n;
  }
  return {
    severe: points(src.severe, DEFAULT_RULES.severe),
    cold: points(src.cold, DEFAULT_RULES.cold),
    vip: points(src.vip, DEFAULT_RULES.vip),
    compliance: points(src.compliance, DEFAULT_RULES.compliance),
    staffing: points(src.staffing, DEFAULT_RULES.staffing),
    heads: Object.keys(heads).length ? heads : { ...DEFAULT_HEADS },
  };
}

function daysUntil(due: string, today: string): number {
  const a = Date.parse(`${due}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((a - b) / 86_400_000);
}

function deptLabel(code: string): string {
  const name = code.trim().toUpperCase();
  if (name === "KITCHEN") return "Kitchen";
  if (name === "FRONT") return "Front";
  if (!name) return "House";
  return name.charAt(0) + name.slice(1).toLowerCase();
}

export function isColdFault(title: string, location: string): boolean {
  return COLD.test(`${title} ${location}`);
}

function stayBits(stay: BriefingStay, view: BriefingView): string {
  const bits = [`${stay.firstName} · room ${stay.room} · party ${stay.party}`];
  if (stay.returning) bits.push("returning");
  if (stay.vip) bits.push("VIP");
  if (stay.flagged && stay.returning) bits.push("flagged");
  if (stay.severe) bits.push("severe allergen");
  if (view === "kitchen" && stay.allergens.length) bits.push(stay.allergens.join(", "));
  if (stay.access) bits.push("accessibility");
  return bits.join(" · ");
}

function severeWhy(stay: BriefingStay, view: BriefingView): string {
  const where = stay.movement === "in_house" ? "is in house" : "arrives today";
  const base = `Rule: severe allergen. ${stay.firstName} ${where}.`;
  if (view === "kitchen" && stay.allergens.length) return `${base} Allergen codes: ${stay.allergens.join(", ")}.`;
  return base;
}

type Scored = Omit<WatchItem, "pinned" | "why"> & { whyKitchen: string; whyHouse: string };

function onShift(facts: BriefingFacts, department: string): number {
  const code = department.toUpperCase();
  const people = new Set(
    facts.shifts.filter(shift => shift.department.toUpperCase() === code).map(shift => shift.userId || shift.id),
  );
  return people.size;
}

export function scoreWatch(facts: BriefingFacts, rules: WatchRules): Scored[] {
  const scored: Scored[] = [];
  for (const stay of facts.stays) {
    if (stay.severe && (stay.movement === "arrival" || stay.movement === "in_house")) {
      const whyKitchen = severeWhy(stay, "kitchen");
      const whyHouse = severeWhy(stay, "house");
      scored.push({
        key: `severe:${stay.id}`,
        rule: "severe",
        points: rules.severe,
        whyKitchen,
        whyHouse,
        title: stay.movement === "in_house" ? `${stay.firstName} in house` : `${stay.firstName} arriving`,
        href: BRIEFING_LINKS.stays,
      });
    }
    if (stay.movement === "arrival" && (stay.vip || (stay.flagged && stay.returning))) {
      const kind = stay.vip ? "VIP arrival" : "flagged returning guest";
      const why = `Rule: ${kind}. ${stay.firstName} arrives today.`;
      scored.push({
        key: `vip:${stay.id}`,
        rule: "vip",
        points: rules.vip,
        whyKitchen: why,
        whyHouse: why,
        title: stay.vip ? `${stay.firstName} · VIP` : `${stay.firstName} · returning`,
        href: BRIEFING_LINKS.guests,
      });
    }
  }
  for (const ticket of facts.tickets) {
    if (!isColdFault(ticket.title, ticket.location)) continue;
    const why = `Rule: fridge or freezer fault. ${ticket.title} at ${ticket.location}.`;
    scored.push({
      key: `cold:${ticket.id || ticket.number}`,
      rule: "cold",
      points: rules.cold,
      whyKitchen: why,
      whyHouse: why,
      title: ticket.title,
      href: BRIEFING_LINKS.tickets,
    });
  }
  for (const item of facts.compliance) {
    if (daysUntil(item.dueOn, facts.date) >= 0) continue;
    const why = `Rule: overdue compliance. ${item.title} was due ${item.dueOn}.`;
    scored.push({
      key: `compliance:${item.id || item.title}`,
      rule: "compliance",
      points: rules.compliance,
      whyKitchen: why,
      whyHouse: why,
      title: item.title,
      href: BRIEFING_LINKS.compliance,
    });
  }
  if (facts.shiftsKnown) {
    for (const [department, need] of Object.entries(rules.heads)) {
      if (need <= 0) continue;
      const on = onShift(facts, department);
      if (on >= need) continue;
      const label = deptLabel(department);
      const why = `Rule: understaffing. ${label} has ${on} on shift. The rota asks for ${need}.`;
      scored.push({
        key: `staff:${department.toUpperCase()}`,
        rule: "staffing",
        points: rules.staffing,
        whyKitchen: why,
        whyHouse: why,
        title: `${label} short`,
        href: BRIEFING_LINKS.shifts,
      });
    }
  }
  return scored;
}

export function topWatch(scored: Scored[], marks: Mark[], view: BriefingView): WatchItem[] {
  const pin = new Set(marks.filter(mark => mark.action === "pin").map(mark => mark.key));
  const dismiss = new Set(marks.filter(mark => mark.action === "dismiss").map(mark => mark.key));
  const visible = scored.filter(item => pin.has(item.key) || !dismiss.has(item.key));
  const byPoints = (a: Scored, b: Scored) => b.points - a.points;
  const pinned = visible.filter(item => pin.has(item.key)).sort(byPoints);
  const rest = visible.filter(item => !pin.has(item.key)).sort(byPoints);
  return [...pinned, ...rest].slice(0, 3).map(item => ({
    key: item.key,
    rule: item.rule,
    points: item.points,
    why: view === "kitchen" ? item.whyKitchen : item.whyHouse,
    title: item.title,
    href: item.href,
    pinned: pin.has(item.key),
  }));
}

function line(key: string, text: string, href: string): BriefingLine {
  return { key, text, href };
}

function section(key: string, title: string, tone: Tone, summary: string, href: string, lines: BriefingLine[]): BriefingSection {
  return {
    key,
    title,
    tone,
    summary,
    href,
    lines: lines.length ? lines : [line(`${key}:empty`, NOTHING, href)],
  };
}

function issueLabel(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (key === "food") return "Food note";
  if (key === "room") return "Room complaint";
  if (key === "staff") return "Staff note";
  if (key === "complaint") return "Guest complaint";
  return "Guest note";
}

export function buildBriefing(input: {
  facts: BriefingFacts;
  view: BriefingView;
  rules: WatchRules;
  marks: Mark[];
  userId: string;
}): BriefingBoard {
  const { facts, view, rules } = input;
  const arrivals = facts.stays.filter(stay => stay.movement === "arrival");
  const departures = facts.stays.filter(stay => stay.movement === "departure");
  const stayLines = [
    ...arrivals.map(stay => line(stay.id, `Arriving · ${stayBits(stay, view)}`, BRIEFING_LINKS.stays)),
    ...departures.map(stay => line(stay.id, `Departing · ${stayBits(stay, view)}`, BRIEFING_LINKS.stays)),
  ];
  const stayTone: Tone = facts.stays.some(stay => stay.movement !== "departure" && stay.severe) || arrivals.concat(departures).some(stay => stay.severe)
    ? "red"
    : arrivals.concat(departures).some(stay => stay.access) ? "amber" : "green";

  const short = facts.shiftsKnown
    ? Object.entries(rules.heads).filter(([department, need]) => need > 0 && onShift(facts, department) < need)
    : [];
  const shiftLines = facts.shiftsKnown
    ? [
      ...facts.shifts.map(shift => line(
        shift.id,
        `${deptLabel(shift.department)} · ${shift.firstName} · ${shift.start}–${shift.end}${shift.swapped ? " · swapped" : ""}`,
        BRIEFING_LINKS.shifts,
      )),
      ...short.map(([department, need]) => line(
        `gap:${department}`,
        `${deptLabel(department)} · ${onShift(facts, department)} on shift · rota asks for ${need}`,
        BRIEFING_LINKS.shifts,
      )),
    ]
    : [];

  const tickets = facts.tickets.map(ticket => {
    const overdue = ticket.ageDays >= 7;
    return line(
      ticket.id || ticket.number,
      `${ticket.number} · ${ticket.title} · ${ticket.priority} · ${ticket.ageDays} days · ${ticket.location}${overdue ? " · overdue" : ""}`,
      BRIEFING_LINKS.tickets,
    );
  });
  const ticketTone: Tone = !facts.tickets.length
    ? "green"
    : facts.tickets.some(ticket => ticket.priority === "SAFETY" || ticket.priority === "URGENT" || ticket.ageDays >= 7 || isColdFault(ticket.title, ticket.location))
      ? "red"
      : "amber";

  const issues = facts.issues.map(issue => line(
    issue.id,
    `${issueLabel(issue.label)}${issue.overdue ? " · overdue" : " · open"}`,
    BRIEFING_LINKS.issues,
  ));

  const stock = facts.stock
    .filter(item => Number(item.quantity) < Number(item.low))
    .map(item => line(item.id, `${item.name} · ${item.quantity} ${item.unit} · low at ${item.low}`, BRIEFING_LINKS.stock));

  const compliance = facts.compliance
    .map(item => ({ ...item, days: daysUntil(item.dueOn, facts.date) }))
    .filter(item => item.days <= 0)
    .map(item => line(
      item.id,
      item.days < 0 ? `${item.title} · overdue ${Math.abs(item.days)} days` : `${item.title} · due today`,
      BRIEFING_LINKS.compliance,
    ));

  const training = facts.training
    .map(item => ({ ...item, days: daysUntil(item.expiresOn, facts.date) }))
    .filter(item => item.days >= 0 && item.days <= 7)
    .map(item => line(item.id, `${item.firstName} · ${item.title} · ${item.expiresOn}`, BRIEFING_LINKS.training));

  const deliveries = facts.deliveries.map(item => line(
    item.id,
    `${item.supplier}${item.detail ? ` · ${item.detail}` : ""}`,
    BRIEFING_LINKS.deliveries,
  ));

  const notes = facts.notes
    .filter(note => !note.ackedBy.includes(input.userId))
    .map(note => line(
      note.id,
      `${note.shift} · ${note.department} · ${note.author} · ${note.excerpt}`,
      BRIEFING_LINKS.notes,
    ));

  const scored = scoreWatch(facts, rules);
  const watch = topWatch(scored, input.marks, view);
  const pin = new Set(input.marks.filter(mark => mark.action === "pin").map(mark => mark.key));
  const dismiss = new Set(input.marks.filter(mark => mark.action === "dismiss").map(mark => mark.key));
  const shown = new Set(watch.map(item => item.key));
  const held = scored
    .filter(item => !shown.has(item.key) && (pin.has(item.key) || !dismiss.has(item.key)))
    .sort((a, b) => b.points - a.points)
    .map(item => ({
      key: item.key,
      rule: item.rule,
      points: item.points,
      why: view === "kitchen" ? item.whyKitchen : item.whyHouse,
      title: item.title,
      href: item.href,
      pinned: pin.has(item.key),
    }));

  const sections: BriefingSection[] = [
    section("stays", "Arrivals and departures", stayTone, arrivals.length || departures.length ? `${arrivals.length} arriving · ${departures.length} departing` : NOTHING, BRIEFING_LINKS.stays, stayLines),
    section("shifts", "Who is on shift", short.length ? "amber" : "green", facts.shifts.length ? `${facts.shifts.length} on the rota` : short.length ? "Short against the rota" : NOTHING, BRIEFING_LINKS.shifts, shiftLines),
    section("tickets", "Maintenance", ticketTone, facts.tickets.length ? `${facts.tickets.length} open` : NOTHING, BRIEFING_LINKS.tickets, tickets),
    section("stock", "Low stock", !stock.length ? "green" : facts.stock.some(item => Number(item.quantity) <= 0) ? "red" : "amber", stock.length ? `${stock.length} low` : NOTHING, BRIEFING_LINKS.stock, stock),
    section("issues", "Guest issues", !issues.length ? "green" : facts.issues.some(issue => issue.overdue) ? "red" : "amber", issues.length ? `${issues.length} open` : NOTHING, BRIEFING_LINKS.issues, issues),
    section("compliance", "Compliance", !compliance.length ? "green" : facts.compliance.some(item => daysUntil(item.dueOn, facts.date) < 0) ? "red" : "amber", compliance.length ? `${compliance.length} due` : NOTHING, BRIEFING_LINKS.compliance, compliance),
    section("training", "Training this week", training.length ? "amber" : "green", training.length ? `${training.length} expiring` : NOTHING, BRIEFING_LINKS.training, training),
    section("deliveries", "Expected deliveries", "green", deliveries.length ? `${deliveries.length} today` : NOTHING, BRIEFING_LINKS.deliveries, deliveries),
    section("notes", "Unread handover", notes.length ? "amber" : "green", notes.length ? `${notes.length} unread` : NOTHING, BRIEFING_LINKS.notes, notes),
  ];

  return {
    date: facts.date,
    view,
    watch,
    held,
    sections,
  };
}
