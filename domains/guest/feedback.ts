/** Post-stay feedback. A signed link, three scores, and a problem route.
 *  Free text is personal data. The text message never carries health information.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const PROBLEM_CATEGORIES = [
  { code: "food", label: "Food" },
  { code: "room", label: "Room" },
  { code: "staff", label: "A member of the team" },
  { code: "other", label: "Something else" },
] as const;

export const CAPA_STATUSES = ["open", "investigating", "action_taken", "verified", "closed"] as const;
export type CapaStatus = (typeof CAPA_STATUSES)[number];
export type ProblemCategory = (typeof PROBLEM_CATEGORIES)[number]["code"];

export type FeedbackEmails = { kitchen: string; front: string; housekeeping: string; manager: string };
export type FeedbackDelay = "morning_after" | { hours: number };
export type FeedbackSettings = {
  delay: FeedbackDelay;
  retention_days: number;
  open_maintenance: boolean;
  emails: FeedbackEmails;
};

export type FeedbackNotice = { to: string; audience: "kitchen" | "front" | "housekeeping" | "manager"; subject: string; body: string };

export type SmsEnv = { TWILIO_ACCOUNT_SID?: string; TWILIO_AUTH_TOKEN?: string; TWILIO_FROM?: string };

const HEALTH = /\b(allerg|anaphyla|diet|medical|illness|medication|disability|pregnan|health)\b/i;

function emailOrNull(value: unknown): string {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email || !email.includes("@") || /\s/.test(email)) return "";
  return email;
}

export function parseFeedbackSettings(raw: unknown): FeedbackSettings {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const box = src.emails && typeof src.emails === "object" ? src.emails as Record<string, unknown> : src;
  let delay: FeedbackDelay = "morning_after";
  const hoursRaw = typeof src.delay === "number"
    ? src.delay
    : src.delay && typeof src.delay === "object"
      ? Number((src.delay as { hours?: unknown }).hours)
      : src.delay === "hours"
        ? Number(src.delay_hours)
        : null;
  if (hoursRaw != null && Number.isFinite(hoursRaw) && hoursRaw >= 0 && hoursRaw <= 24 * 21) delay = { hours: Math.round(hoursRaw) };
  const retention = Number(src.retention_days ?? 365);
  return {
    delay,
    retention_days: Number.isFinite(retention) ? Math.min(3650, Math.max(30, Math.round(retention))) : 365,
    open_maintenance: src.open_maintenance !== false && src.open_maintenance !== "false",
    emails: {
      kitchen: emailOrNull(box.kitchen),
      front: emailOrNull(box.front ?? box.foh),
      housekeeping: emailOrNull(box.housekeeping ?? box.hk),
      manager: emailOrNull(box.manager ?? box.gm),
    },
  };
}

function zonedTime(y: number, m: number, d: number, h: number, min = 0): Date {
  const utcGuess = Date.UTC(y, m - 1, d, h, min);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(utcGuess));
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return new Date(utcGuess + (utcGuess - shown));
}

/** When the note may go out. Morning after is 08:00 London the day after departure. */
export function feedbackDueAt(departureDate: string, settings: FeedbackSettings): Date | null {
  const [y, m, d] = departureDate.split("-").map(Number);
  if (!y || !m || !d) return null;
  if (settings.delay === "morning_after") {
    const next = new Date(Date.UTC(y, m - 1, d));
    next.setUTCDate(next.getUTCDate() + 1);
    return zonedTime(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 8, 0);
  }
  return new Date(zonedTime(y, m, d, 11, 0).getTime() + settings.delay.hours * 60 * 60 * 1000);
}

export function readyToInvite(departureDate: string, settings: FeedbackSettings, now = new Date()): boolean {
  const due = feedbackDueAt(departureDate, settings);
  return !!due && now.getTime() >= due.getTime();
}

export function signFeedbackToken(inviteId: string, exp: number, secret: string): string {
  const body = `${inviteId}.${exp}`;
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readFeedbackToken(token: string, secret: string, now = new Date()): { ok: true; inviteId: string; exp: number } | { ok: false; error: string } {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) return { ok: false, error: "This link is not valid" };
  const [inviteId, expRaw, sig] = parts;
  if (!/^[0-9a-f-]{36}$/i.test(inviteId)) return { ok: false, error: "This link is not valid" };
  const exp = Number(expRaw);
  if (!Number.isFinite(exp)) return { ok: false, error: "This link is not valid" };
  const expected = createHmac("sha256", secret).update(`${inviteId}.${expRaw}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, error: "This link is not valid" };
  if (exp * 1000 <= now.getTime()) return { ok: false, error: "This link has expired" };
  return { ok: true, inviteId, exp };
}

export function firstNameOnly(name: string | null | undefined): string {
  const word = String(name ?? "").trim().split(/\s+/)[0] ?? "";
  if (!word || word.length < 2) return "Guest";
  return word.replace(/[^\p{L}'-]/gu, "").slice(0, 40) || "Guest";
}

function score(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 5) return null;
  return n;
}

export function parseSubmission(raw: unknown): {
  ok: true;
  food: number; room: number; overall: number;
  comment: string; problem: boolean; category: ProblemCategory | null; detail: string;
} | { ok: false; error: string } {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const food = score(src.food ?? src.food_score);
  const room = score(src.room ?? src.room_score);
  const overall = score(src.overall ?? src.overall_score);
  if (!food || !room || !overall) return { ok: false, error: "Tap a score for the food, the room, and the stay" };
  const comment = String(src.comment ?? "").trim().slice(0, 2000);
  const problem = src.problem === true || src.problem === "true";
  const categoryRaw = String(src.category ?? "").trim().toLowerCase();
  const known = PROBLEM_CATEGORIES.some(c => c.code === categoryRaw);
  if (problem && !known) return { ok: false, error: "Choose what went wrong" };
  const detail = String(src.detail ?? src.problem_detail ?? "").trim().slice(0, 2000);
  if (problem && detail.length < 3) return { ok: false, error: "Tell us a little about what went wrong" };
  return { ok: true, food, room, overall, comment, problem, category: problem ? categoryRaw as ProblemCategory : null, detail: problem ? detail : "" };
}

export function isKind(overall: number, problem: boolean): boolean {
  return !problem && overall >= 4;
}

export function feedbackNotices(
  item: { category: ProblemCategory; firstName: string; detail: string },
  settings: FeedbackSettings,
): FeedbackNotice[] {
  const label = PROBLEM_CATEGORIES.find(c => c.code === item.category)?.label ?? "A stay";
  const subject = `Guest feedback · ${label}`;
  const body = [
    `${item.firstName} flagged something after their stay.`,
    "",
    item.detail,
    "",
    "This note is personal data. Keep it inside the house.",
    "A corrective action is open on the feedback board.",
  ].join("\n");
  const want: FeedbackNotice["audience"][] = item.category === "food"
    ? ["kitchen", "manager"]
    : item.category === "room"
      ? ["front", "housekeeping", "manager"]
      : ["manager"];
  const notes: FeedbackNotice[] = [];
  for (const audience of want) {
    const to = settings.emails[audience];
    if (!to || notes.some(n => n.to === to)) continue;
    notes.push({ to, audience, subject, body });
  }
  return notes;
}

export function wantsMaintenance(category: ProblemCategory | null, settings: FeedbackSettings): boolean {
  return category === "room" && settings.open_maintenance;
}

export function guestEmail(firstName: string, url: string, propertyName: string): { subject: string; body: string } {
  const who = firstName === "Guest" ? "Hello" : `Dear ${firstName}`;
  return {
    subject: `How was your stay at ${propertyName}?`,
    body: `${who},

Thank you for staying with us. If you have a moment, tell us how the food, the room and the stay felt. It takes less than a minute.

${url}

The link works once, then it closes.

With warm regards,
${propertyName}`,
  };
}

export function smsInvite(url: string): { ok: true; body: string } | { ok: false; error: string } {
  const body = `Thank you for staying with us. Tell us how it went: ${url}`;
  if (HEALTH.test(body) || body.length > 320) return { ok: false, error: "The text message must stay short and must not include health information" };
  return { ok: true, body };
}

export function smsConfigured(env: SmsEnv): boolean {
  return !!(env.TWILIO_ACCOUNT_SID?.trim() && env.TWILIO_AUTH_TOKEN?.trim() && env.TWILIO_FROM?.trim());
}

export function phoneOk(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.replace(/\D/g, "").length < 10 || digits.length > 20) return "";
  return digits;
}

export function shouldAnonymise(createdAt: Date, retentionDays: number, now = new Date()): boolean {
  return now.getTime() - createdAt.getTime() > retentionDays * 24 * 60 * 60 * 1000;
}

export function capaStatusOk(status: unknown): status is CapaStatus {
  return CAPA_STATUSES.includes(status as CapaStatus);
}

export const SCORE_LABELS = ["Poor", "Fair", "Good", "Very good", "Wonderful"];
