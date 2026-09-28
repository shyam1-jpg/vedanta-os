/** Living house manuals. Defaults live in code; the house can edit or withdraw them.
 * The default book is a set of empty sections. Earlier wording is kept in
 * manual-legacy.ts and, once stored, is not overwritten.
 */

import { OPS_DEPARTMENTS, type OpsDepartment } from "./board.ts";

export const MANUAL_KINDS = ["APP", "SOP", "SAFETY", "LOOK", "HOSPITALITY"] as const;
export type ManualKind = (typeof MANUAL_KINDS)[number];
export type ManualStatus = "live" | "withdrawn";
export type ManualCatalogue = "current" | "archive";

export type ManualStep = { title: string; look: string; act: string; note?: string };
export type ManualNode = { title: string; caption: string };

export type ManualChapter = {
  slug: string;
  department: OpsDepartment;
  kind: ManualKind;
  title: string;
  summary: string;
  body: string;
  steps: ManualStep[];
  diagram: ManualNode[];
  sort_order: number;
};

export const MANUAL_KIND_LABEL: Record<ManualKind, string> = {
  APP: "How to use the house",
  SOP: "How the work is done",
  SAFETY: "Safety",
  LOOK: "How it should look",
  HOSPITALITY: "How we meet people",
};

/** Shown on a section that has not yet been written. */
export const MANUAL_PLACEHOLDER_NOTE = "Content to be added";

export function isManualKind(v: unknown): v is ManualKind {
  return typeof v === "string" && (MANUAL_KINDS as readonly string[]).includes(v);
}

export function parseManualStatus(v: unknown): ManualStatus {
  return String(v ?? "").toLowerCase() === "withdrawn" ? "withdrawn" : "live";
}

export function parseManualCatalogue(v: unknown): ManualCatalogue {
  return String(v ?? "").toLowerCase() === "archive" ? "archive" : "current";
}

export function chapterToPocketBody(ch: Pick<ManualChapter, "summary" | "body" | "steps">): string {
  const steps = ch.steps.map((s, i) =>
    `${i + 1}. ${s.title}\n   Look: ${s.look}\n   Act: ${s.act}${s.note ? `\n   Note: ${s.note}` : ""}`).join("\n\n");
  const stepsBlock = steps ? `\n\nThe steps\n${steps}` : `\n\n${MANUAL_PLACEHOLDER_NOTE}`;
  return `What it should look like\n${ch.summary}\n\nHow to act\n${ch.body}${stepsBlock}`;
}

function section(
  slug: string,
  title: string,
  summary: string,
  body: string,
  kind: ManualKind,
  sort_order: number,
): ManualChapter {
  return {
    slug,
    department: "HOUSE",
    kind,
    title,
    summary,
    body,
    steps: [],
    diagram: [],
    sort_order,
  };
}

/** Generic sections for the default manual. No property, brand, place, or person. */
export const HOUSE_MANUALS: ManualChapter[] = [
  section(
    "welcome",
    "Welcome and how to use this manual",
    "This manual is the house reference for how the work is done.",
    "Read the section for the task in front of you, and replace this note with the procedure the house has agreed.",
    "APP",
    10,
  ),
  section(
    "organisation-and-roles",
    "Organisation and roles",
    "The house is organised into departments, each with a head who owns the standard and a team who carries it out.",
    "Record here who reports to whom, which decisions sit with which role, and how a new colleague finds their place.",
    "SOP",
    20,
  ),
  section(
    "arrival-and-departure",
    "Arrival and departure procedures",
    "Arrivals and departures are planned, greeted, and recorded so the house is ready and nobody is left waiting.",
    "Set out the steps from the day before arrival through to the room being released after departure.",
    "SOP",
    30,
  ),
  section(
    "guest-services",
    "Guest services",
    "Guest services cover the requests, information, and small cares that make a stay feel looked after.",
    "Describe how a request is taken, who acts on it, and how the guest is told when it is done.",
    "HOSPITALITY",
    40,
  ),
  section(
    "housekeeping",
    "Housekeeping",
    "Housekeeping keeps rooms and public areas clean, stocked, and ready, with a lighter service during a stay and a full service on departure.",
    "Write the room standard, the order of work, and what must be reported before a room is marked ready.",
    "SOP",
    50,
  ),
  section(
    "kitchen-and-food-safety",
    "Kitchen and food safety",
    "The kitchen prepares food that is safe to eat, held at the correct temperature, and served from clean stations.",
    "Record the opening checks, temperature control, cleaning, and the close-down the next team can trust.",
    "SOP",
    60,
  ),
  section(
    "allergens-and-diets",
    "Allergen and special diet management",
    "Allergens and special diets are written down before service and checked again before a plate leaves the kitchen.",
    "Set out how a dietary need is captured, who confirms it, and how service stops when the information is missing.",
    "SAFETY",
    70,
  ),
  section(
    "health-safety-fire",
    "Health, safety and fire",
    "Health, safety and fire procedures keep people clear of harm and say what to do when an alarm sounds.",
    "Note the assembly arrangements, who takes a roll, where first aid is kept, and the checks that are walked each day.",
    "SAFETY",
    80,
  ),
  section(
    "security-and-emergency",
    "Security and emergency procedures",
    "Security and emergency procedures say who secures the house, who is on call, and how an incident is raised without delay.",
    "Describe door routines, the care of lost property, and the order of calls when something is urgent.",
    "SAFETY",
    90,
  ),
  section(
    "maintenance-and-faults",
    "Maintenance and reporting faults",
    "A fault is written down with a place and a priority, made safe, and then repaired.",
    "Explain how to report a fault, which ones are urgent, and how the person who reported it hears that it is closed.",
    "SOP",
    100,
  ),
  section(
    "accessibility",
    "Accessibility",
    "Accessibility covers step-free routes, rooms that suit particular needs, and how the house prepares when a need is known in advance.",
    "Record what the house can offer, what it cannot, and who confirms an arrangement before arrival.",
    "LOOK",
    110,
  ),
  section(
    "data-protection",
    "Data protection and confidentiality",
    "Guest and staff information is used only for the stay or the employment, and it is not discussed where it can be overheard.",
    "Set out what may be written in a shared log, what stays in a private record, and how long each kind of record is kept.",
    "SOP",
    120,
  ),
  section(
    "staff-conduct",
    "Staff conduct and wellbeing",
    "Conduct on duty is calm, discreet, and fair. Wellbeing means a person can step off the floor and ask for help.",
    "Describe the standard of behaviour with guests and colleagues, and where someone takes a concern.",
    "HOSPITALITY",
    130,
  ),
  section(
    "rotas-leave-timekeeping",
    "Rotas, leave and timekeeping",
    "The rota shows who is on duty, leave is requested ahead of time, and hours are recorded when a shift starts and when it ends.",
    "Note who publishes the rota, how leave is approved, and how the hours are checked.",
    "SOP",
    140,
  ),
  section(
    "suppliers-and-deliveries",
    "Suppliers and deliveries",
    "Orders and deliveries are expected, checked on arrival, and stored so the house is not short.",
    "Record who may place an order, how a delivery is signed for, and what to do if it is short or damaged.",
    "SOP",
    150,
  ),
  section(
    "sustainability",
    "Sustainability",
    "Sustainability is the habit of wasting less energy, water, food, and materials, without lowering the standard of the stay.",
    "Write the practices the house has chosen, and who reviews them.",
    "LOOK",
    160,
  ),
  section(
    "contacts",
    "Contacts",
    "This section will hold the names and numbers the house needs on a shift, once they have been agreed.",
    "Until those contacts are written here, use the duty manager and the emergency procedure for anything urgent.",
    "APP",
    170,
  ),
];

export function manualsForDepartment(code: string, chapters: ManualChapter[] = HOUSE_MANUALS): ManualChapter[] {
  return chapters.filter(c => c.department === code).sort((a, b) => a.sort_order - b.sort_order);
}

export function defaultManual(slug: string): ManualChapter | undefined {
  return HOUSE_MANUALS.find(c => c.slug === slug);
}

/** Chapters not already stored. Existing rows are left untouched. */
export function missingManualChapters(existingSlugs: Iterable<string>, chapters: ManualChapter[] = HOUSE_MANUALS): ManualChapter[] {
  const have = new Set(existingSlugs);
  return chapters.filter(c => !have.has(c.slug));
}

export function manualDepartments(): { code: string; label: string }[] {
  const used = new Set(HOUSE_MANUALS.map(c => c.department));
  return OPS_DEPARTMENTS.filter(d => used.has(d.code)).map(d => ({ code: d.code, label: d.label }));
}
