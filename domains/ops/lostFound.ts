/** Lost and found. Guest contact is personal data and is cleared once the item is closed.
 *  The matcher (suggest, tell the guest on confirm, purge after the hold) stays off until the house switches it on.
 *  A score never confirms a match. Photos stay in the house log and are not returned on a public page. */
import { phoneOk } from "../guest/feedback.ts";

export const LOST_CATEGORIES = [
  { code: "clothing", label: "Clothing" },
  { code: "electronics", label: "Electronics" },
  { code: "jewellery", label: "Jewellery" },
  { code: "documents", label: "Documents" },
  { code: "keys", label: "Keys" },
  { code: "bags", label: "Bags" },
  { code: "other", label: "Other" },
] as const;

export const LOST_STATUSES = ["logged", "matched", "claimed", "returned", "disposed", "donated", "expired"] as const;
export type LostStatus = (typeof LOST_STATUSES)[number];

export const RETURN_METHODS = [
  { code: "posted", label: "Posted" },
  { code: "collected", label: "Collected" },
] as const;

const NEXT: Record<LostStatus, LostStatus[]> = {
  logged: ["matched", "claimed", "disposed", "donated"],
  matched: ["claimed", "logged", "disposed", "donated"],
  claimed: ["returned", "logged"],
  returned: [],
  disposed: [],
  donated: [],
  expired: [],
};

export const LOST_CONSENT = "I agree the house may contact me about this item.";
export const MATCH_DATE_NEAR_DAYS = 2;
export const MATCH_DATE_WINDOW_DAYS = 14;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function emailOrNull(value: unknown): string {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email || !email.includes("@") || /\s/.test(email)) return "";
  return email;
}

export function categoryOk(value: unknown): boolean {
  return LOST_CATEGORIES.some(c => c.code === value);
}

export function parseLostSettings(raw: unknown): {
  hold_days: number; disposal_days: number; postage_note: string; link_days: number; manager: string;
  matcher: boolean; purge_days: number;
} {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const days = Math.round(Number(src.hold_days ?? 90));
  const disposal = Math.round(Number(src.disposal_days ?? 30));
  const linkDays = Math.round(Number(src.link_days ?? 14));
  const purge = Math.round(Number(src.purge_days ?? 90));
  const postage = String(src.postage_note ?? "Postage cost TBC").trim().slice(0, 80);
  return {
    hold_days: Number.isFinite(days) ? Math.min(3650, Math.max(7, days)) : 90,
    disposal_days: Number.isFinite(disposal) ? Math.min(3650, Math.max(1, disposal)) : 30,
    postage_note: postage || "Postage cost TBC",
    link_days: Number.isFinite(linkDays) ? Math.min(60, Math.max(1, linkDays)) : 14,
    manager: emailOrNull(src.manager ?? src.gm),
    matcher: src.matcher === true,
    purge_days: Number.isFinite(purge) ? Math.min(3650, Math.max(7, purge)) : 90,
  };
}

export function nextLostStatus(from: string, to: string): LostStatus | null {
  const allowed = NEXT[from as LostStatus];
  if (!allowed || !allowed.includes(to as LostStatus)) return null;
  return to as LostStatus;
}

export function closedStatus(status: string): boolean {
  return status === "returned" || status === "disposed" || status === "donated" || status === "expired";
}

/** Personal details come off after the purge period. Nothing is removed while the matcher is off. */
export function retentionDue(openedOn: string, today: string, purgeDays: number, enabled: boolean): boolean {
  if (!enabled) return false;
  return heldTooLong(openedOn, today, purgeDays, "logged");
}

export function heldTooLong(foundOn: string, today: string, holdDays: number, status: string): boolean {
  if (closedStatus(status)) return false;
  const found = Date.parse(`${foundOn}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(found) || !Number.isFinite(now)) return false;
  return (now - found) / 86_400_000 >= holdDays;
}

function words(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2);
}

export type MatchReport = {
  description: string;
  category?: string | null;
  place?: string | null;
  happened_on?: string | null;
  rooms?: string[] | null;
  stay_from?: string | null;
  stay_to?: string | null;
};

export type MatchItem = {
  id: string;
  description: string;
  category?: string | null;
  place?: string | null;
  found_on?: string | null;
  status: string;
};

function roomHit(place: string, rooms: string[]): boolean {
  const text = place.toLowerCase();
  return rooms.some(room => {
    const code = room.toLowerCase();
    return text === code || text === `room ${code}` || text.endsWith(` ${code}`);
  });
}

/** Shared words, or a close stem when the words are not the same. */
export function textSimilarity(left: string, right: string): { overlap: string[]; close: boolean } {
  const wanted = words(left);
  const found = words(right);
  const wantedSet = new Set(wanted);
  const overlap = [...new Set(found.filter(word => wantedSet.has(word)))];
  const close = overlap.length === 0 && wanted.some(word => word.length >= 4 && found.some(other => other !== word && (other.startsWith(word) || word.startsWith(other))));
  return { overlap, close };
}

export function explainMatch(report: MatchReport, item: MatchItem): { score: number; reasons: string[] } {
  if (closedStatus(item.status)) return { score: 0, reasons: [] };
  let score = 0;
  const reasons: string[] = [];
  const similar = textSimilarity(report.description, item.description);
  if (similar.overlap.length) {
    score += similar.overlap.length * 3;
    reasons.push(`Same words: ${similar.overlap.slice(0, 4).join(", ")}`);
  } else if (similar.close) {
    score += 1;
    reasons.push("Similar wording");
  }
  if (report.category && report.category === item.category) {
    score += 2;
    reasons.push("Same category");
  }
  if (report.place && item.place && report.place.toLowerCase() === item.place.toLowerCase()) {
    score += 3;
    reasons.push("Same place");
  }
  if (item.place && report.rooms?.length && roomHit(item.place, report.rooms)) {
    score += 3;
    reasons.push("Found in a room from the stay");
  }
  if (report.happened_on && item.found_on && DATE.test(report.happened_on) && DATE.test(item.found_on)) {
    const days = Math.abs(Date.parse(`${item.found_on}T00:00:00Z`) - Date.parse(`${report.happened_on}T00:00:00Z`)) / 86_400_000;
    if (days <= MATCH_DATE_NEAR_DAYS) { score += 3; reasons.push("Found within 2 days"); }
    else if (days <= MATCH_DATE_WINDOW_DAYS) { score += 1; reasons.push("Found within two weeks"); }
  } else if (item.found_on && report.stay_from && report.stay_to && DATE.test(item.found_on) && DATE.test(report.stay_from) && DATE.test(report.stay_to)) {
    const foundOn = Date.parse(`${item.found_on}T00:00:00Z`);
    const from = Date.parse(`${report.stay_from}T00:00:00Z`) - 2 * 86_400_000;
    const to = Date.parse(`${report.stay_to}T00:00:00Z`) + 2 * 86_400_000;
    if (foundOn >= from && foundOn <= to) { score += 2; reasons.push("Close to the stay"); }
  }
  return { score, reasons };
}

export function matchScore(report: MatchReport, item: MatchItem): number {
  return explainMatch(report, item).score;
}

export type RankedMatch<T> = { item: T; score: number; reasons: string[] };

export function rankMatches<T extends MatchItem>(report: MatchReport, items: T[], rejected: string[] = []): RankedMatch<T>[] {
  const skip = new Set(rejected);
  return items
    .filter(item => !skip.has(item.id))
    .map(item => ({ item, ...explainMatch(report, item) }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
    .slice(0, 5);
}

export function suggestMatches<T extends MatchItem>(report: MatchReport, items: T[], rejected: string[] = []): T[] {
  return rankMatches(report, items, rejected).map(row => row.item);
}

export type MatchReportRow = MatchReport & { id: string; status: string; rejected?: string[] | null };

/** Likely missing reports for a found item. The list is a suggestion. Status is left as it was. */
export function rankReportsForItem<T extends MatchReportRow>(item: MatchItem, reports: T[]): RankedMatch<T>[] {
  return reports
    .filter(report => report.status === "open" && !(report.rejected ?? []).includes(item.id))
    .map(report => ({ item: report, ...explainMatch(report, item) }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
    .slice(0, 5);
}

/** Eligible for disposal once the hold has run from the found date, or from the day the guest was told. */
export function disposalDue(input: {
  foundOn: string;
  notifiedOn?: string | null;
  holdUntil?: string | null;
  today: string;
  disposalDays: number;
  status: string;
}): boolean {
  if (closedStatus(input.status)) return false;
  if (input.holdUntil && DATE.test(input.holdUntil) && input.holdUntil > input.today) return false;
  const start = input.notifiedOn && DATE.test(input.notifiedOn.slice(0, 10)) ? input.notifiedOn.slice(0, 10) : input.foundOn;
  return heldTooLong(start, input.today, input.disposalDays, input.status);
}

export function lostReference(id: string): string {
  return `LF-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

export function lostGuestMessage(input: { house: string; item: string; link: string }): { subject: string; body: string; sms: string } {
  const item = input.item.trim().slice(0, 80);
  const subject = `Something you may have left at ${input.house}`;
  const body = [
    `We think we have found an item that may be yours: ${item}.`,
    "",
    "Open this link to choose collection or postage. No payment is taken.",
    input.link,
    "",
    "The link expires. If this is not yours, you can ignore it.",
  ].join("\n");
  const sms = `Possible lost property at ${input.house}: ${item}. Choose collection or postage (no payment): ${input.link}`.slice(0, 320);
  return { subject, body, sms };
}

export type LostNoticePlan =
  | { action: "skip"; reason: string }
  | { action: "send"; channel: "email" | "sms"; to: string; subject: string; body: string };

/** One channel. Operational, and only if the guest agreed to be contacted about this item. */
export function planLostNotice(input: {
  consent: boolean;
  email: string;
  phone: string;
  prefsOn: boolean;
  operationalChannel: "email" | "sms" | "none";
  subject: string;
  body: string;
  sms: string;
}): LostNoticePlan {
  if (!input.consent) return { action: "skip", reason: "The guest did not agree to be contacted about this item" };
  const email = input.email.trim();
  const phone = input.phone.trim();
  if (!email && !phone) return { action: "skip", reason: "There is no email or phone on this report" };
  const channel = input.prefsOn ? input.operationalChannel : (email ? "email" : "sms");
  if (channel === "none") return { action: "skip", reason: "The guest asked not to be contacted by email or text" };
  if (channel === "email" && !email) return { action: "skip", reason: "The guest asked for email, and there is no email on this report" };
  if (channel === "sms" && !phone) return { action: "skip", reason: "The guest asked for a text, and there is no phone on this report" };
  if (channel === "email") return { action: "send", channel, to: email, subject: input.subject, body: input.body };
  return { action: "send", channel: "sms", to: phone, subject: input.subject, body: input.sms };
}

export type LostNoticeDraft = {
  channel: "email" | "sms";
  to: string;
  subject: string;
  body: string;
  kind: "lost_found_guest";
  email?: string;
  tenantId: string;
  propertyId: string;
  userId: string | null;
  relatedId: string;
};

export type LostNoticeSender = (draft: LostNoticeDraft) => Promise<{ status: string; id?: string | null }>;

/** Records the letter locally. SMTP and SMS are not configured, so nothing leaves the house. */
export function stubLostNoticeSender(log: LostNoticeDraft[] = []): LostNoticeSender {
  return async draft => {
    log.push({ ...draft });
    return { status: "LOGGED", id: null };
  };
}

export async function dispatchNotice(
  plan: LostNoticePlan,
  sender: LostNoticeSender,
  ctx: { email: string; tenantId: string; propertyId: string; userId: string | null; relatedId: string },
): Promise<{ channel: "email" | "sms" | "none"; status: string; reason: string | null }> {
  if (plan.action === "skip") return { channel: "none", status: "SKIPPED", reason: plan.reason };
  try {
    const sent = await sender({
      channel: plan.channel,
      to: plan.to,
      subject: plan.subject,
      body: plan.body,
      kind: "lost_found_guest",
      email: ctx.email || undefined,
      tenantId: ctx.tenantId,
      propertyId: ctx.propertyId,
      userId: ctx.userId,
      relatedId: ctx.relatedId,
    });
    return { channel: plan.channel, status: sent.status || "LOGGED", reason: null };
  } catch {
    return { channel: plan.channel, status: "FAILED", reason: "The message could not be sent" };
  }
}

export function staffChoiceNote(input: { reference: string; choice: string; detail: string }): { subject: string; body: string } {
  return {
    subject: `Lost property choice · ${input.reference}`,
    body: `The guest chose ${input.choice} for ${input.reference}.\n\n${input.detail}\n\nNo payment has been taken.`,
  };
}

export function disposalNotice(count: number, days: number): { subject: string; body: string } {
  return {
    subject: `Lost property eligible for disposal`,
    body: `${count} unclaimed item${count === 1 ? "" : "s"} ${count === 1 ? "is" : "are"} past ${days} days and eligible for disposal. The list is on Lost and found. Choose disposed, donated, or keep longer.`,
  };
}

export function parseReturnChoice(raw: unknown): { ok: true; choice: "collection" | "postage"; detail: string } | { ok: false; error: string } {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const choice = String(src.choice ?? "");
  if (choice === "collection") {
    const date = String(src.date ?? "").slice(0, 10);
    const time = String(src.time ?? "").trim().slice(0, 5);
    if (!DATE.test(date)) return { ok: false, error: "Choose the collection date" };
    if (!/^\d{2}:\d{2}$/.test(time)) return { ok: false, error: "Choose the collection time" };
    return { ok: true, choice, detail: `Collection on ${date} at ${time}` };
  }
  if (choice === "postage") {
    const address = String(src.address ?? "").trim().slice(0, 300);
    if (address.length < 8) return { ok: false, error: "Write the address for postage" };
    return { ok: true, choice, detail: `Postage to ${address}` };
  }
  return { ok: false, error: "Choose collection or postage" };
}

export function parseKeep(raw: unknown, today: string): { ok: true; until: string; reason: string } | { ok: false; error: string } {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const until = String(src.until ?? "").slice(0, 10);
  const reason = String(src.reason ?? "").trim().slice(0, 300);
  if (!DATE.test(until) || until <= today) return { ok: false, error: "Choose a later date to keep it" };
  if (reason.length < 3) return { ok: false, error: "Say why it should be kept longer" };
  return { ok: true, until, reason };
}

export function parseSignature(raw: unknown): { ok: true; data: string } | { ok: false; error: string } {
  const data = String((raw && typeof raw === "object" ? (raw as Record<string, unknown>).signature : "") ?? "");
  if (!data.startsWith("data:image/png;base64,")) return { ok: false, error: "The signature needs to be drawn on the screen" };
  if (data.length < 40 || data.length > 200_000) return { ok: false, error: "That signature could not be saved" };
  return { ok: true, data };
}

export type ReturnSlip = {
  reference: string;
  description: string;
  foundPlace: string;
  foundOn: string;
  guestName: string;
  bookingRef: string;
  method: string;
  handler: string;
  hasPhoto: boolean;
};

export function slipLines(slip: ReturnSlip): string[] {
  return [
    "Lost property return",
    `Reference ${slip.reference}`,
    "",
    slip.description,
    slip.hasPhoto ? "Photo filed with this item." : "No photo.",
    `Found at ${slip.foundPlace} on ${slip.foundOn}`,
    `Guest ${slip.guestName || "Not named"}`,
    `Booking ${slip.bookingRef || "Not linked"}`,
    `Return ${slip.method || "Not chosen yet"}`,
    `Handled by ${slip.handler || "Staff"}`,
    "",
    "Guest signature",
    "______________________________",
  ];
}

function escapePdf(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[^\x20-\x7E]/g, "?");
}

function jpegSize(buf: Uint8Array): { w: number; h: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 8 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    const len = (buf[i + 2] << 8) | buf[i + 3];
    if (marker === 0xc0 || marker === 0xc2) return { h: (buf[i + 5] << 8) | buf[i + 6], w: (buf[i + 7] << 8) | buf[i + 8] };
    if (!len) return null;
    i += 2 + len;
  }
  return null;
}

/** Printable return slip. A5 is half an A4 page. A JPEG thumbnail is drawn when one is filed. */
export function renderSlipPdf(lines: string[], size: "a4" | "a5", jpeg?: Uint8Array): Uint8Array {
  const a5 = size === "a5";
  const media = a5 ? "0 0 420 595" : "0 0 595 842";
  const startY = a5 ? 540 : 780;
  const dims = jpeg ? jpegSize(jpeg) : null;
  const image = !!(jpeg && dims && dims.w > 0 && dims.h > 0);
  const fontId = image ? 6 : 5;
  const contentId = image ? 5 : 4;
  const pageId = image ? 4 : 3;
  const commands = ["BT", "/F1 11 Tf", `40 ${startY} Td`, "14 TL"];
  for (const line of lines) commands.push(`(${escapePdf(line.slice(0, 90))}) Tj`, "T*");
  commands.push("ET");
  if (image && dims && jpeg) {
    const width = 90;
    const height = Math.max(24, Math.round(width * (dims.h / dims.w)));
    const y = a5 ? 20 : 40;
    commands.unshift("q", `${width} 0 0 ${height} 40 ${y} cm`, "/Im1 Do", "Q");
  }
  const stream = commands.join("\n");
  const objects: (string | Uint8Array)[] = [];
  objects.push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n");
  objects.push(`2 0 obj << /Type /Pages /Count 1 /Kids [${pageId} 0 R] >> endobj\n`);
  if (image && jpeg && dims) {
    objects.push(`3 0 obj << /Type /XObject /Subtype /Image /Width ${dims.w} /Height ${dims.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >> stream\n`);
    objects.push(jpeg);
    objects.push("\nendstream endobj\n");
  }
  const resources = image
    ? `/Resources << /Font << /F1 ${fontId} 0 R >> /XObject << /Im1 3 0 R >> >>`
    : `/Resources << /Font << /F1 ${fontId} 0 R >> >>`;
  objects.push(`${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [${media}] /Contents ${contentId} 0 R ${resources} >> endobj\n`);
  objects.push(`${contentId} 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj\n`);
  objects.push(`${fontId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n`);
  const chunks: Uint8Array[] = [new TextEncoder().encode("%PDF-1.4\n")];
  const offsets = [0];
  let length = chunks[0].length;
  let objNum = 0;
  for (const obj of objects) {
    const bytes = typeof obj === "string" ? new TextEncoder().encode(obj) : obj;
    if (typeof obj === "string" && /^\d+ 0 obj/.test(obj)) {
      objNum += 1;
      offsets[objNum] = length;
    }
    chunks.push(bytes);
    length += bytes.length;
  }
  const xrefAt = length;
  let xref = `xref\n0 ${objNum + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objNum; i++) xref += `${String(offsets[i] ?? 0).padStart(10, "0")} 00000 n \n`;
  xref += `trailer << /Size ${objNum + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  chunks.push(new TextEncoder().encode(xref));
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  return out;
}

export function parseFoundItem(raw: unknown): {
  ok: true; description: string; category: string; place: string; foundOn: string; storage: string;
} | { ok: false; error: string } {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const description = String(src.description ?? "").trim().slice(0, 500);
  if (description.length < 3) return { ok: false, error: "Describe what was found" };
  const category = String(src.category ?? "other").trim();
  if (!categoryOk(category)) return { ok: false, error: "Choose a category" };
  const place = String(src.place ?? src.location ?? "").trim().slice(0, 80);
  if (!place) return { ok: false, error: "Say where it was found" };
  const foundOn = String(src.found_on ?? "").slice(0, 10);
  if (!DATE.test(foundOn)) return { ok: false, error: "Choose the date it was found" };
  const storage = String(src.storage ?? src.storage_location ?? "").trim().slice(0, 120);
  return { ok: true, description, category, place, foundOn, storage };
}

export function parseMissingReport(raw: unknown): {
  ok: true; description: string; category: string; place: string; happenedOn: string; contactName: string; contactEmail: string; contactPhone: string; contactConsent: boolean;
} | { ok: false; error: string } {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const description = String(src.description ?? "").trim().slice(0, 500);
  if (description.length < 3) return { ok: false, error: "Describe what is missing" };
  const category = String(src.category ?? "other").trim();
  if (!categoryOk(category)) return { ok: false, error: "Choose a category" };
  const place = String(src.place ?? src.location ?? "").trim().slice(0, 80);
  const happenedOn = String(src.happened_on ?? "").slice(0, 10);
  if (happenedOn && !DATE.test(happenedOn)) return { ok: false, error: "That date is not valid" };
  const contactEmail = emailOrNull(src.contact_email);
  if (String(src.contact_email ?? "").trim() && !contactEmail) return { ok: false, error: "That email address is not valid" };
  return {
    ok: true,
    description,
    category,
    place,
    happenedOn,
    contactName: String(src.contact_name ?? "").trim().slice(0, 80),
    contactEmail,
    contactPhone: String(src.contact_phone ?? "").trim().slice(0, 30),
    contactConsent: src.consent === true || src.contact_consent === true,
  };
}

/** Public report during or after a stay. Contact and a tick to be told about this item are required. */
export function parseGuestReport(raw: unknown): {
  ok: true; description: string; category: string; place: string; happenedOn: string; contactName: string; contactEmail: string; contactPhone: string; contactConsent: true; bookingRef: string;
} | { ok: false; error: string } {
  const parsed = parseMissingReport(raw);
  if (!parsed.ok) return parsed;
  if (/https?:\/\//i.test(parsed.description)) return { ok: false, error: "Leave out links" };
  if (!parsed.place) return { ok: false, error: "Say where you last had it" };
  if (!parsed.happenedOn) return { ok: false, error: "Say when you lost it" };
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const phoneRaw = String(src.contact_phone ?? "").trim();
  const phone = phoneOk(phoneRaw);
  if (phoneRaw && !phone) return { ok: false, error: "That phone number is not valid" };
  if (!parsed.contactEmail && !phone) return { ok: false, error: "Leave an email or a phone number" };
  if (!parsed.contactConsent) return { ok: false, error: "Tick the box to agree the house may contact you about this item" };
  const bookingRef = String(src.booking_ref ?? "").trim().slice(0, 40);
  return { ...parsed, contactPhone: phone || parsed.contactPhone, contactConsent: true, bookingRef };
}

export function parseStatusChange(raw: unknown, from: string): {
  ok: true; status: LostStatus; claimant: string; method: string | null; note: string; recipient: string;
} | { ok: false; error: string } {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const status = nextLostStatus(from, String(src.status ?? ""));
  if (!status) return { ok: false, error: "That status is not the next step" };
  const claimant = String(src.claimant_name ?? "").trim().slice(0, 80);
  const method = String(src.return_method ?? "").trim();
  if ((status === "claimed" || status === "returned") && claimant.length < 2) return { ok: false, error: "Say who claimed it" };
  if (status === "returned" && method !== "posted" && method !== "collected") return { ok: false, error: "Say whether it was posted or collected" };
  const note = String(src.note ?? src.reason ?? "").trim().slice(0, 500);
  const recipient = String(src.recipient ?? "").trim().slice(0, 120);
  if (status === "disposed" && note.length < 3) return { ok: false, error: "Say why it is being disposed of" };
  if (status === "donated" && recipient.length < 2) return { ok: false, error: "Say who it was donated to" };
  if (status === "donated" && note.length < 3) return { ok: false, error: "Say why it is being donated" };
  return { ok: true, status, claimant, method: status === "returned" ? method : null, note, recipient };
}

export function retentionNotice(count: number, holdDays: number): { subject: string; body: string } {
  return {
    subject: `Lost property held more than ${holdDays} days`,
    body: `${count} found item${count === 1 ? "" : "s"} ${count === 1 ? "has" : "have"} been held longer than ${holdDays} days. Review them for return, disposal, or donation. Do not put guest contact details in a reply.`,
  };
}
