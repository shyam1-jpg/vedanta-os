/**
 * Guest journey. One set of rules for the letters the house sends and for digital check-in.
 * Service messages are part of a booking the guest already has, so they go without marketing consent.
 * A rebook note is marketing: it needs opt-in, and an unsubscribe stops it.
 * The scheduler, the mail helper, and the text adapter live in the API. This module only decides.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SERVICE_KINDS = [
  "pre_arrival",
  "see_you_tomorrow",
  "organiser_pre_arrival",
  "organiser_tomorrow",
  "thank_you",
] as const;

export const MARKETING_KINDS = ["rebook"] as const;

export const JOURNEY_KINDS = [...SERVICE_KINDS, ...MARKETING_KINDS] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];
export type MarketingKind = (typeof MARKETING_KINDS)[number];
export type JourneyKind = (typeof JOURNEY_KINDS)[number];

export const ARRIVAL_STATUSES = ["expected", "en_route", "checked_in_digitally", "arrived", "keys_issued"] as const;
export type ArrivalStatus = (typeof ARRIVAL_STATUSES)[number];

export const MERGE_FIELDS = [
  "first_name",
  "group_name",
  "property_name",
  "arrival",
  "departure",
  "details_link",
  "stay_link",
  "feedback_link",
  "rebook_link",
  "unsubscribe_link",
  "house_rules",
  "what_to_bring",
  "directions",
  "arrival_window",
  "retreats",
  "guest_lines",
  "key_instructions",
] as const;

export type JourneySettings = {
  sequences: {
    pre_arrival: boolean;
    see_you_tomorrow: boolean;
    check_in: boolean;
    post_stay: boolean;
    rebook: boolean;
  };
  pre_arrival_days: number;
  check_in_time: string;
  rebook_days: number;
  id_required: boolean;
  emergency_retention_days: number;
  house_rules: string;
  what_to_bring: string;
  directions: string;
  key_instructions: string;
  templates: Partial<Record<JourneyKind, { subject: string; body: string }>>;
};

export const DEFAULT_HOUSE_RULES = [
  "The kitchen is pure vegetarian: no eggs, no onion, and no garlic. Meals are a buffet. Food is never billed.",
  "Quiet hours are from 22:00 to 07:00.",
  "The goshala is the cows' home. Guests only visit the cows with staff.",
].join("\n");

export const DEFAULT_WHAT_TO_BRING = "Comfortable clothes, a warm layer for the evening, and any medicine you already take. The house provides bedding and towels.";

export const DEFAULT_DIRECTIONS = "The house will meet the arrival window in this letter. If the last part of the journey is unclear, reply and the desk will help.";

export const DEFAULT_KEYS = "Keys are collected from the front desk. The desk will say if a room is ready.";

const NEXT: Record<ArrivalStatus, ArrivalStatus[]> = {
  expected: ["en_route", "checked_in_digitally", "arrived"],
  en_route: ["checked_in_digitally", "arrived"],
  checked_in_digitally: ["arrived", "keys_issued"],
  arrived: ["keys_issued"],
  keys_issued: [],
};

const STATUS_LABEL: Record<ArrivalStatus, string> = {
  expected: "expected",
  en_route: "en route",
  checked_in_digitally: "checked in digitally",
  arrived: "arrived",
  keys_issued: "keys issued",
};

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function text(value: unknown, fallback: string, max = 4000): string {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  return raw.slice(0, max);
}

function on(value: unknown, fallback: boolean): boolean {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return fallback;
}

function clock(value: unknown, fallback: string): string {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return fallback;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parseJourneySettings(raw: unknown): JourneySettings {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const sequences = src.sequences && typeof src.sequences === "object" ? src.sequences as Record<string, unknown> : {};
  const templates = src.templates && typeof src.templates === "object" ? src.templates as Record<string, unknown> : {};
  const kept: JourneySettings["templates"] = {};
  for (const kind of JOURNEY_KINDS) {
    const row = templates[kind];
    if (!row || typeof row !== "object") continue;
    const subject = String((row as { subject?: unknown }).subject ?? "").trim().slice(0, 200);
    const body = String((row as { body?: unknown }).body ?? "").trim().slice(0, 8000);
    if (subject && body) kept[kind] = { subject, body };
  }
  return {
    sequences: {
      pre_arrival: on(sequences.pre_arrival, true),
      see_you_tomorrow: on(sequences.see_you_tomorrow, true),
      check_in: on(sequences.check_in, false),
      post_stay: on(sequences.post_stay, true),
      rebook: on(sequences.rebook, true),
    },
    pre_arrival_days: clamp(src.pre_arrival_days, 5, 1, 30),
    check_in_time: clock(src.check_in_time, "08:00"),
    rebook_days: clamp(src.rebook_days, 30, 1, 365),
    id_required: src.id_required === true || src.id_required === "true",
    emergency_retention_days: clamp(src.emergency_retention_days, 30, 1, 3650),
    house_rules: text(src.house_rules, DEFAULT_HOUSE_RULES),
    what_to_bring: text(src.what_to_bring, DEFAULT_WHAT_TO_BRING),
    directions: text(src.directions, DEFAULT_DIRECTIONS),
    key_instructions: text(src.key_instructions, DEFAULT_KEYS),
    templates: kept,
  };
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function minutesOf(clockText: string): number {
  const [h, m] = clock(clockText, "00:00").split(":").map(Number);
  return h * 60 + m;
}

function inWindow(today: string, arrival: string, offsetDays: number): boolean {
  return today >= addDays(arrival, -offsetDays) && today < arrival;
}

export type GuestGate = {
  marketingConsent: boolean;
  unsubscribed: boolean;
};

export function maySend(kind: JourneyKind, gate: GuestGate, sequenceOn: boolean): { ok: true } | { ok: false; reason: string } {
  if (!sequenceOn) return { ok: false, reason: "That sequence is switched off" };
  if (MARKETING_KINDS.includes(kind as MarketingKind)) {
    if (gate.unsubscribed) return { ok: false, reason: "The guest has unsubscribed" };
    if (!gate.marketingConsent) return { ok: false, reason: "Marketing needs opt-in consent" };
  }
  return { ok: true };
}

export type PlanInput = {
  today: string;
  arrival: string;
  departure: string;
  settings: JourneySettings;
  sent: JourneyKind[];
  detailsComplete: boolean;
  marketingConsent: boolean;
  unsubscribed: boolean;
  rebooked: boolean;
  openComplaint: boolean;
  feedbackReady: boolean;
  stayThankYouSent?: boolean;
  skipThankYou?: boolean;
};

export type MessagePlan = { kind: JourneyKind; variant: "collect" | "confirm" | "tomorrow" | "thanks" | "return" };

/** Which letters are due for one guest. A kind already sent is never due again. */
export function planGuestMessages(input: PlanInput): MessagePlan[] {
  const sent = new Set(input.sent);
  const plans: MessagePlan[] = [];
  const preWindow = input.settings.sequences.pre_arrival && inWindow(input.today, input.arrival, input.settings.pre_arrival_days);
  const tomorrowWindow = input.settings.sequences.see_you_tomorrow && inWindow(input.today, input.arrival, 1);
  const preDue = preWindow && !sent.has("pre_arrival") && !tomorrowWindow;
  const tomorrowDue = tomorrowWindow && !sent.has("see_you_tomorrow");
  if (preDue) plans.push({ kind: "pre_arrival", variant: input.detailsComplete ? "confirm" : "collect" });
  if (tomorrowDue) plans.push({ kind: "see_you_tomorrow", variant: "tomorrow" });
  if (input.settings.sequences.post_stay && input.feedbackReady && !sent.has("thank_you") && !input.skipThankYou && !input.stayThankYouSent) {
    plans.push({ kind: "thank_you", variant: "thanks" });
  }
  const rebookDay = addDays(input.departure, input.settings.rebook_days);
  const thankYouDone = sent.has("thank_you") || !!input.stayThankYouSent;
  if (
    input.settings.sequences.rebook
    && input.today >= rebookDay
    && thankYouDone
    && !sent.has("rebook")
    && !input.rebooked
    && !input.openComplaint
  ) {
    const gate = maySend("rebook", input, true);
    if (gate.ok) plans.push({ kind: "rebook", variant: "return" });
  }
  return plans.filter(plan => {
    const sequenceOn = plan.kind === "pre_arrival" || plan.kind === "organiser_pre_arrival"
      ? input.settings.sequences.pre_arrival
      : plan.kind === "see_you_tomorrow" || plan.kind === "organiser_tomorrow"
        ? input.settings.sequences.see_you_tomorrow
        : plan.kind === "thank_you"
          ? input.settings.sequences.post_stay
          : input.settings.sequences.rebook;
    return maySend(plan.kind, input, sequenceOn).ok;
  });
}

export function summaryWave(today: string, arrival: string, settings: JourneySettings): "pre_arrival" | "see_you_tomorrow" | null {
  if (settings.sequences.see_you_tomorrow && inWindow(today, arrival, 1)) return "see_you_tomorrow";
  if (settings.sequences.pre_arrival && inWindow(today, arrival, settings.pre_arrival_days)) return "pre_arrival";
  return null;
}

export function organiserSummaryDue(input: { wave: "pre_arrival" | "see_you_tomorrow"; alreadySent: boolean; sequenceOn: boolean }): boolean {
  return input.sequenceOn && !input.alreadySent;
}

export function claimSend(existing: { kind: string }[], kind: JourneyKind): boolean {
  return !existing.some(row => row.kind === kind);
}

export type TemplatePair = { subject: string; body: string };

export function defaultTemplate(kind: JourneyKind): TemplatePair {
  const sign = "With warm regards,\n{{property_name}}";
  switch (kind) {
    case "pre_arrival":
      return {
        subject: "Before you travel — {{group_name}}",
        body: `Dear {{first_name}},

We are looking forward to welcoming you on {{arrival}}.

What to bring
{{what_to_bring}}

House notes
{{house_rules}}

Finding us
{{directions}}

Arrival
{{arrival_window}}

Please complete or confirm your diet, allergens, and access needs here. The link needs no login:
{{details_link}}

You can also pre-fill arrival details for the morning you arrive:
{{stay_link}}

${sign}`,
      };
    case "see_you_tomorrow":
      return {
        subject: "See you tomorrow — {{group_name}}",
        body: `Dear {{first_name}},

This is a short note to say we will see you tomorrow, {{arrival}}.

{{arrival_window}}

{{directions}}

Your stay link, if anything still needs confirming:
{{stay_link}}

${sign}`,
      };
    case "organiser_pre_arrival":
    case "organiser_tomorrow":
      return {
        subject: "Guest letters for {{group_name}}",
        body: `Dear {{first_name}},

The house has written to the guests on {{group_name}} ({{arrival}} to {{departure}}).

{{guest_lines}}

Guests without an email address are still on the list. You can add an address, or invite them to fill in their own diet and access details.

${sign}`,
      };
    case "thank_you":
      return {
        subject: "Thank you for staying at {{property_name}}",
        body: `Dear {{first_name}},

Thank you for staying with us. If you have a moment, tell us how the food, the room, and the stay felt. It takes less than a minute.

{{feedback_link}}

The link works once, then it closes.

${sign}`,
      };
    case "rebook":
      return {
        subject: "A quiet note from {{property_name}}",
        body: `Dear {{first_name}},

If a return visit would suit you, these retreats are open to book:

{{retreats}}

{{rebook_link}}

This is a message about future stays. If you would rather not hear them, use this link:
{{unsubscribe_link}}

${sign}`,
      };
    default:
      return { subject: "{{property_name}}", body: sign };
  }
}

export function templateFor(settings: JourneySettings, kind: JourneyKind): TemplatePair {
  return settings.templates[kind] ?? defaultTemplate(kind);
}

export function renderMerge(template: string, fields: Record<string, string>): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_all, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(fields, name)) {
      if (!missing.includes(name)) missing.push(name);
      return "";
    }
    return fields[name] ?? "";
  });
  return { text, missing };
}

export function previewFields(): Record<string, string> {
  return {
    first_name: "Test",
    group_name: "Example Autumn Retreat",
    property_name: "The Vedanta",
    arrival: "Monday 12 October 2026",
    departure: "Friday 16 October 2026",
    details_link: "https://example.invalid/arrive/?t=preview-details",
    stay_link: "https://example.invalid/arrive/?t=preview-stay",
    feedback_link: "https://example.invalid/stay-note/?t=preview-feedback",
    rebook_link: "https://example.invalid/book/",
    unsubscribe_link: "https://example.invalid/opt-out/?t=preview",
    house_rules: DEFAULT_HOUSE_RULES,
    what_to_bring: DEFAULT_WHAT_TO_BRING,
    directions: DEFAULT_DIRECTIONS,
    arrival_window: "Arrival is from 15:00.",
    retreats: "Example Spring Retreat — 2 November 2026",
    guest_lines: "Test Client 01 — letter sent\nTest Client 03 — no email address",
    key_instructions: DEFAULT_KEYS,
  };
}

const HEALTH = /\b(allerg|anaphyla|diet|medical|illness|medication|disability|pregnan|health)\b/i;

export function journeySms(kind: JourneyKind, url: string): { ok: true; body: string } | { ok: false; error: string } {
  const body = kind === "rebook"
    ? `A note from the house about a future stay: ${url}`
    : kind === "thank_you"
      ? `Thank you for staying with us. Tell us how it went: ${url}`
      : `A note about your stay is ready: ${url}`;
  if (HEALTH.test(body) || body.length > 320) return { ok: false, error: "The text must stay short and must not include health information" };
  return { ok: true, body };
}

export function signJourneyToken(input: { personId: string; groupId: string; purpose: "stay" | "details" | "unsubscribe" }, exp: number, secret: string): string {
  const body = `${input.personId}.${input.groupId}.${input.purpose}.${exp}`;
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readJourneyToken(token: string, secret: string, now = new Date()): { ok: true; personId: string; groupId: string; purpose: "stay" | "details" | "unsubscribe"; exp: number } | { ok: false; error: string } {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 5) return { ok: false, error: "This link is not valid" };
  const [personId, groupId, purpose, expRaw, sig] = parts;
  if (!/^[0-9a-f-]{36}$/i.test(personId) || !/^[0-9a-f-]{36}$/i.test(groupId)) return { ok: false, error: "This link is not valid" };
  if (purpose !== "stay" && purpose !== "details" && purpose !== "unsubscribe") return { ok: false, error: "This link is not valid" };
  const exp = Number(expRaw);
  if (!Number.isFinite(exp)) return { ok: false, error: "This link is not valid" };
  const expected = createHmac("sha256", secret).update(`${personId}.${groupId}.${purpose}.${expRaw}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, error: "This link is not valid" };
  if (exp * 1000 <= now.getTime()) return { ok: false, error: "This link has expired" };
  return { ok: true, personId, groupId, purpose, exp };
}

export function transitionArrival(from: ArrivalStatus, to: ArrivalStatus): { ok: true } | { ok: false; error: string } {
  if (!ARRIVAL_STATUSES.includes(from) || !ARRIVAL_STATUSES.includes(to)) return { ok: false, error: "That status is not on the board" };
  if (from === to) return { ok: true };
  if (!NEXT[from].includes(to)) return { ok: false, error: `A guest who is ${STATUS_LABEL[from]} cannot be marked ${STATUS_LABEL[to]}` };
  return { ok: true };
}

export function arrivalStatusLabel(status: ArrivalStatus): string {
  return STATUS_LABEL[status];
}

export function checkInSummary(statuses: ArrivalStatus[]): string {
  if (!statuses.length) return "";
  const counts = new Map<ArrivalStatus, number>();
  for (const status of statuses) counts.set(status, (counts.get(status) ?? 0) + 1);
  return ARRIVAL_STATUSES.filter(status => counts.has(status) && status !== "expected")
    .map(status => `${counts.get(status)} ${STATUS_LABEL[status]}`)
    .join(", ");
}

export function checkInWindowOpen(input: { flag: boolean; today: string; arrival: string; minutes: number; from: string }): boolean {
  if (!input.flag) return false;
  if (input.today !== input.arrival) return false;
  return input.minutes >= minutesOf(input.from);
}

export function checkInReady(input: {
  flag: boolean;
  today: string;
  arrival: string;
  minutes: number;
  from: string;
  rulesAck: boolean;
  detailsConfirmed: boolean;
  idRequired: boolean;
  idSeen: boolean;
}): { ok: true } | { ok: false; error: string } {
  if (!checkInWindowOpen(input)) return { ok: false, error: input.flag ? "Check-in opens on arrival day" : "Digital check-in is switched off" };
  if (!input.detailsConfirmed) return { ok: false, error: "Confirm the stay details first" };
  if (!input.rulesAck) return { ok: false, error: "The house rules need a tick" };
  if (input.idRequired && !input.idSeen) return { ok: false, error: "Identification is required for this stay" };
  return { ok: true };
}

export function roomForGuest(input: { assigned: string | null; released: boolean }): { show: string | null; note: string } {
  if (!input.assigned) return { show: null, note: "Your room appears here once the house has assigned it." };
  if (!input.released) return { show: null, note: "Your room is assigned. The desk will release it when it is ready." };
  return { show: input.assigned, note: "" };
}

export function mayPlaceWalkUp(input: { occupantLocked: boolean }): { ok: true } | { ok: false; error: string } {
  if (input.occupantLocked) return { ok: false, error: "That room was locked for the organiser. It stays as they left it." };
  return { ok: true };
}

export function emergencyUntil(departure: string, days: number): string {
  return addDays(departure, days);
}

export function emergencyDueForRemoval(until: string, today: string): boolean {
  return !!until && today > until;
}

export function retreatList(items: { name: string; arrival: string }[]): string {
  const lines = items
    .map(item => ({ name: item.name.trim(), arrival: item.arrival.trim() }))
    .filter(item => item.name && item.arrival)
    .map(item => `${item.name} — ${item.arrival}`);
  if (!lines.length) return "The next published retreats will appear on the website.";
  return lines.join("\n");
}

export function ownsLegacyPreArrival(settings: JourneySettings): boolean {
  return settings.sequences.pre_arrival;
}

export function ownsFeedbackLetter(settings: JourneySettings): boolean {
  return settings.sequences.post_stay;
}
