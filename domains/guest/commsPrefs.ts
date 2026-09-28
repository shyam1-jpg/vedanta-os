/**
 * How a guest hears from the house. Marketing is opt-in and starts unticked.
 * A booking message can still go, on the channel they chose, and it waits out quiet hours unless it cannot wait.
 * Staff notes are not guest preferences. The switch defaults to off: the check still runs, and it does not hold mail until the house turns it on.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const CHANNELS = ["email", "sms", "none"] as const;
export type Channel = (typeof CHANNELS)[number];

export const WORDING_VERSION = "2026-09-28";
export const MARKETING_WORDING = "Send me occasional notes about future retreats. This is optional. Messages about a booking I already have are separate.";

export type CommsPrefs = {
  operationalChannel: Channel;
  marketing: boolean;
  marketingChannel: Channel;
  quietFrom: string;
  quietTo: string;
  consentAt: string | null;
  consentSource: string | null;
  wordingVersion: string | null;
  wording: string | null;
};

export type ConsentEvent = {
  marketing: boolean;
  source: string;
  wordingVersion: string;
  wording: string;
  at: string;
};

export const DEFAULT_PREFS: CommsPrefs = {
  operationalChannel: "email",
  marketing: false,
  marketingChannel: "none",
  quietFrom: "22:00",
  quietTo: "07:00",
  consentAt: null,
  consentSource: null,
  wordingVersion: null,
  wording: null,
};

export type MessagePurpose = "operational" | "marketing" | "staff";

const MARKETING_KINDS = new Set(["journey_rebook", "auto_rebook"]);

const GUEST_KINDS = new Set([
  "form_link",
  "confirmation",
  "feedback_invite",
  "lost_found_guest",
  "guest_report_follow_up",
  "guest_verify_email",
  "guest_access_code",
  "deposit_received",
  "organiser_rooms",
  "journey_pre_arrival",
  "journey_see_you_tomorrow",
  "journey_thank_you",
  "journey_check_in",
  "journey_organiser_pre_arrival",
  "journey_organiser_tomorrow",
  "auto_booking_confirmed",
  "auto_balance_reminder",
  "auto_pre_arrival",
  "auto_checkout",
  "auto_checkout_reminder",
]);

const URGENT_KINDS = new Set([
  "guest_verify_email",
  "guest_access_code",
  "confirmation",
  "auto_booking_confirmed",
  "deposit_received",
  "journey_check_in",
  "journey_see_you_tomorrow",
  "form_link",
]);

export function classifyMessage(kind: string, audience?: "guest" | "staff"): { purpose: MessagePurpose; urgent: boolean } {
  if (audience === "staff") return { purpose: "staff", urgent: true };
  if (kind === "auto_staff_new_enquiry" || kind.startsWith("staff_") || kind.startsWith("fault_") || kind.startsWith("stock_") || kind.startsWith("training_") || kind.startsWith("spend_") || kind === "night_audit" || kind === "shift_swap" || kind === "scheduler_error" || kind.startsWith("lost_found_retention") || kind.startsWith("lost_found_disposal") || kind.startsWith("lost_found_choice") || (kind.startsWith("feedback_") && kind !== "feedback_invite")) {
    return { purpose: "staff", urgent: true };
  }
  if (MARKETING_KINDS.has(kind)) return { purpose: "marketing", urgent: false };
  if (GUEST_KINDS.has(kind) || kind.startsWith("journey_") || kind.startsWith("auto_")) {
    return { purpose: kind.includes("rebook") ? "marketing" : "operational", urgent: URGENT_KINDS.has(kind) };
  }
  return { purpose: "staff", urgent: true };
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

function channel(value: unknown, fallback: Channel): Channel {
  const raw = String(value ?? "");
  return (CHANNELS as readonly string[]).includes(raw) ? raw as Channel : fallback;
}

export function parseCommsPrefs(raw: unknown): CommsPrefs {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PREFS };
  const src = raw as Record<string, unknown>;
  const marketing = src.marketing === true;
  return {
    operationalChannel: channel(src.operationalChannel ?? src.operational_channel, "email"),
    marketing,
    marketingChannel: marketing ? channel(src.marketingChannel ?? src.marketing_channel, "none") : "none",
    quietFrom: clock(src.quietFrom ?? src.quiet_from, "22:00"),
    quietTo: clock(src.quietTo ?? src.quiet_to, "07:00"),
    consentAt: src.consentAt ? String(src.consentAt) : src.consent_at ? String(src.consent_at) : null,
    consentSource: src.consentSource ? String(src.consentSource) : src.consent_source ? String(src.consent_source) : null,
    wordingVersion: src.wordingVersion ? String(src.wordingVersion) : src.wording_version ? String(src.wording_version) : null,
    wording: src.wording ? String(src.wording) : null,
  };
}

export function parseCommsFlag(raw: unknown): boolean {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return src.enabled === true || src.enabled === "true";
}

export function saveChoice(input: {
  operationalChannel: unknown;
  marketing?: unknown;
  marketingChannel?: unknown;
  quietFrom: unknown;
  quietTo: unknown;
  at: string;
  source: string;
  previous: CommsPrefs | null;
}): { ok: true; prefs: CommsPrefs; event: ConsentEvent | null } | { ok: false; error: string } {
  if (input.operationalChannel != null && input.operationalChannel !== "" && !(CHANNELS as readonly string[]).includes(String(input.operationalChannel))) {
    return { ok: false, error: "Choose email, text, or none" };
  }
  const operationalChannel = channel(input.operationalChannel, "email");
  const marketing = input.marketing === true;
  if (marketing && input.marketingChannel != null && !(CHANNELS as readonly string[]).includes(String(input.marketingChannel))) {
    return { ok: false, error: "Choose email or text for retreat notes, or leave that box unticked" };
  }
  let marketingChannel = channel(input.marketingChannel, marketing ? "email" : "none");
  if (!marketing) marketingChannel = "none";
  if (marketing && marketingChannel === "none") return { ok: false, error: "Choose email or text for retreat notes, or leave that box unticked" };
  const quietFrom = clock(input.quietFrom, "");
  const quietTo = clock(input.quietTo, "");
  if (!quietFrom || !quietTo) return { ok: false, error: "Quiet hours need a start and an end, as 22:00" };
  const previous = input.previous ?? DEFAULT_PREFS;
  const prefs: CommsPrefs = {
    operationalChannel,
    marketing,
    marketingChannel,
    quietFrom,
    quietTo,
    consentAt: previous.consentAt,
    consentSource: previous.consentSource,
    wordingVersion: previous.wordingVersion,
    wording: previous.wording,
  };
  const changed = previous.marketing !== marketing || (marketing && previous.marketingChannel !== marketingChannel) || input.source === "unsubscribe_link";
  let event: ConsentEvent | null = null;
  if (changed) {
    prefs.consentAt = input.at;
    prefs.consentSource = input.source;
    prefs.wordingVersion = WORDING_VERSION;
    prefs.wording = MARKETING_WORDING;
    event = { marketing, source: input.source, wordingVersion: WORDING_VERSION, wording: MARKETING_WORDING, at: input.at };
  }
  return { ok: true, prefs, event };
}

export function unsubscribeChoice(previous: CommsPrefs | null, at: string): { prefs: CommsPrefs; event: ConsentEvent } {
  const saved = saveChoice({
    operationalChannel: previous?.operationalChannel ?? "email",
    marketing: false,
    marketingChannel: "none",
    quietFrom: previous?.quietFrom ?? "22:00",
    quietTo: previous?.quietTo ?? "07:00",
    at,
    source: "unsubscribe_link",
    previous,
  });
  if (!saved.ok || !saved.event) {
    const prefs = { ...(previous ?? DEFAULT_PREFS), marketing: false, marketingChannel: "none" as const, consentAt: at, consentSource: "unsubscribe_link", wordingVersion: WORDING_VERSION, wording: MARKETING_WORDING };
    return { prefs, event: { marketing: false, source: "unsubscribe_link", wordingVersion: WORDING_VERSION, wording: MARKETING_WORDING, at } };
  }
  return { prefs: saved.prefs, event: saved.event };
}

export function londonMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const hour = Number(parts.find(part => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find(part => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function toMinutes(clockText: string): number {
  const [h, m] = clock(clockText, "00:00").split(":").map(Number);
  return h * 60 + m;
}

export function inQuietHours(now: Date, quietFrom: string, quietTo: string): boolean {
  const minutes = londonMinutes(now);
  const start = toMinutes(quietFrom);
  const end = toMinutes(quietTo);
  if (start === end) return false;
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}

export function nextQuietEnd(now: Date, quietTo: string): string {
  const target = toMinutes(quietTo);
  for (let step = 1; step <= 24 * 60; step += 1) {
    const candidate = new Date(now.getTime() + step * 60_000);
    if (londonMinutes(candidate) === target) return candidate.toISOString();
  }
  return new Date(now.getTime() + 8 * 3_600_000).toISOString();
}

export type DeliveryDecision = {
  action: "send" | "skip" | "defer";
  applied: boolean;
  reason: string;
  notBefore?: string;
  purpose: MessagePurpose;
  footer?: string;
};

export function guestFooter(purpose: "operational" | "marketing", links: { preferences: string; unsubscribe: string }): string {
  const lines = ["", "---", `How you hear from The Vedanta: ${links.preferences}`];
  if (purpose === "marketing") lines.push(`Unsubscribe from notes about future retreats: ${links.unsubscribe}`);
  return lines.join("\n");
}

export function decideDelivery(input: {
  flagOn: boolean;
  kind: string;
  channel: "email" | "sms";
  audience?: "guest" | "staff";
  urgent?: boolean;
  prefs: CommsPrefs | null;
  now: Date;
  links?: { preferences: string; unsubscribe: string };
}): DeliveryDecision {
  const classified = classifyMessage(input.kind, input.audience);
  const purpose = classified.purpose;
  const urgent = input.urgent ?? classified.urgent;
  if (!input.flagOn) return { action: "send", applied: false, reason: "Communication preferences are switched off", purpose };
  if (purpose === "staff") return { action: "send", applied: true, reason: "Staff message", purpose };
  const prefs = input.prefs ?? DEFAULT_PREFS;
  const chosen = purpose === "marketing" ? prefs.marketingChannel : prefs.operationalChannel;
  if (purpose === "marketing" && (!prefs.marketing || !prefs.consentAt || !prefs.wordingVersion)) {
    return { action: "skip", applied: true, reason: "Marketing needs opt-in consent", purpose };
  }
  if (chosen === "none" || chosen !== input.channel) {
    return { action: "skip", applied: true, reason: chosen === "none" ? "The guest chose not to be contacted on this" : `The guest asked for ${chosen}`, purpose };
  }
  if (!urgent && inQuietHours(input.now, prefs.quietFrom, prefs.quietTo)) {
    return { action: "defer", applied: true, reason: "Quiet hours", purpose, notBefore: nextQuietEnd(input.now, prefs.quietTo) };
  }
  const decision: DeliveryDecision = { action: "send", applied: true, reason: urgent ? "Time-critical" : "Allowed", purpose };
  if (input.links && (purpose === "operational" || purpose === "marketing")) decision.footer = guestFooter(purpose, input.links);
  return decision;
}

export function signCommsToken(email: string, purpose: "prefs" | "unsubscribe", exp: number, secret: string): string {
  const body = Buffer.from(JSON.stringify({ email: email.trim().toLowerCase(), purpose, exp })).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readCommsToken(token: string, secret: string, now = Date.now()): { ok: true; email: string; purpose: "prefs" | "unsubscribe" } | { ok: false; error: string } {
  const [body, sig] = String(token ?? "").split(".");
  if (!body || !sig) return { ok: false, error: "This link is not valid" };
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, error: "This link is not valid" };
  let parsed: { email?: string; purpose?: string; exp?: number };
  try { parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); }
  catch { return { ok: false, error: "This link is not valid" }; }
  if (!parsed.email?.includes("@") || (parsed.purpose !== "prefs" && parsed.purpose !== "unsubscribe")) return { ok: false, error: "This link is not valid" };
  if (!parsed.exp || parsed.exp < now) return { ok: false, error: "This link has expired" };
  return { ok: true, email: parsed.email, purpose: parsed.purpose };
}
