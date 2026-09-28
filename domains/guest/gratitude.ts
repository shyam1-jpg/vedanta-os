/**
 * Guest gratitude — a thank-you note, a placeholder tip, or a small gesture.
 *
 * No money is captured here. The only payment provider records "pledged, not paid".
 * A card processor can be plugged in later by implementing GratitudePaymentProvider
 * and selecting it from the API; this module must stay the default until then.
 *
 * Distribution is not decided here. Notes are not split across staff and are not
 * linked to a staff user. A manager at the house decides that later.
 *
 * Recipient names in this catalogue are placeholders. Do not put real staff names here.
 */

export const GRATITUDE_NOTICE =
  "Tips are not collected online yet. Any amount is a PLACEHOLDER for the house, not a payment.";

export const GRATITUDE_LIMITS = { message: 500, name: 80 } as const;
export const GRATITUDE_AMOUNT_MIN_PENCE = 100;
export const GRATITUDE_AMOUNT_MAX_PENCE = 50_000;
export const GRATITUDE_RATE = { max: 5, windowMs: 10 * 60_000 } as const;

export type GratitudeKind = "team" | "department" | "person";

export type GratitudeRecipient = {
  id: string;
  kind: GratitudeKind;
  label: string;
  group: string;
};

/** Placeholder catalogue only. These are not payroll identities. */
export const GRATITUDE_RECIPIENTS: readonly GratitudeRecipient[] = [
  { id: "team", kind: "team", label: "The whole team", group: "House" },
  { id: "kitchen", kind: "department", label: "Kitchen", group: "Departments" },
  { id: "housekeeping", kind: "department", label: "Housekeeping", group: "Departments" },
  { id: "reception", kind: "department", label: "Reception", group: "Departments" },
  { id: "member-a", kind: "person", label: "Team member A", group: "People" },
  { id: "chef-b", kind: "person", label: "Chef B", group: "People" },
];

export const GRATITUDE_GESTURES = [
  { id: "tea", label: "Tea for the team" },
  { id: "treat", label: "A small treat" },
  { id: "flowers", label: "Flowers" },
] as const;

export type GratitudeGestureId = (typeof GRATITUDE_GESTURES)[number]["id"];

export function publicCatalogue() {
  return {
    notice: GRATITUDE_NOTICE,
    payments: "placeholder" as const,
    presets: [5, 10, 20] as const,
    amount_min: GRATITUDE_AMOUNT_MIN_PENCE / 100,
    amount_max: GRATITUDE_AMOUNT_MAX_PENCE / 100,
    limits: GRATITUDE_LIMITS,
    gestures: GRATITUDE_GESTURES.map(g => ({ id: g.id, label: g.label })),
    recipients: GRATITUDE_RECIPIENTS.map(r => ({ id: r.id, kind: r.kind, label: r.label, group: r.group })),
  };
}

/** Storage flag. Unset, empty, or anything other than a truthy token stays off. */
export function gratitudeStoreEnabled(value: string | undefined | null): boolean {
  if (value == null) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export type RateBucket = { count: number; start: number };

export function nextRateBucket(
  prev: RateBucket | undefined,
  now: number,
  opts: { max: number; windowMs: number } = GRATITUDE_RATE,
): { allowed: boolean; bucket: RateBucket } {
  if (!prev || now - prev.start >= opts.windowMs) {
    return { allowed: true, bucket: { count: 1, start: now } };
  }
  const count = prev.count + 1;
  return { allowed: count <= opts.max, bucket: { count, start: prev.start } };
}

/**
 * Payment seam. The placeholder never contacts a processor and cannot report a capture.
 * A future provider would be a second implementation of this interface, chosen by the API,
 * and would need its own migration before a captured status can be stored.
 */
export interface GratitudePaymentProvider {
  readonly id: string;
  record(input: { amount: string | null; currency: "GBP" }): {
    status: "pledged_not_paid";
    provider: string;
    providerRef: null;
  };
}

export const placeholderGratitudePayments: GratitudePaymentProvider = {
  id: "placeholder",
  record() {
    return { status: "pledged_not_paid", provider: "placeholder", providerRef: null };
  },
};

export type PreparedGratitude = {
  recipient: GratitudeRecipient;
  message: string | null;
  guestName: string | null;
  anonymous: boolean;
  gesture: { id: string; label: string } | null;
  amount: string | null;
  currency: "GBP";
  payment: ReturnType<GratitudePaymentProvider["record"]>;
  distributionStatus: "undecided";
};

export type PrepareResult =
  | { ok: false; detail: string }
  | { ok: true; discarded: boolean; prepared: PreparedGratitude };

export type GratitudeInput = {
  recipientId?: unknown;
  message?: unknown;
  guestName?: unknown;
  amount?: unknown;
  gesture?: unknown;
  /** Honeypot. Real guests never see this field. */
  company?: unknown;
};

function cleanMessage(value: unknown): string {
  return String(value ?? "").replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim();
}

function cleanName(value: unknown): string {
  return String(value ?? "").replace(/\u0000/g, "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
}

export function parseGratitudeAmount(value: unknown): { ok: true; amount: string | null } | { ok: false; detail: string } {
  if (value == null) return { ok: true, amount: null };
  const raw = (typeof value === "number"
    ? (Number.isFinite(value) ? value.toFixed(2) : "")
    : String(value).trim().replace(/^£/, "").replace(/,/g, ""));
  if (!raw || raw === "0" || raw === "0.0" || raw === "0.00") return { ok: true, amount: null };
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    return { ok: false, detail: "Enter an amount in pounds, such as 10 or 12.50." };
  }
  const [pounds, frac = ""] = raw.split(".");
  const pence = Number(pounds) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(pence)) {
    return { ok: false, detail: "Enter an amount in pounds, such as 10 or 12.50." };
  }
  if (pence < GRATITUDE_AMOUNT_MIN_PENCE || pence > GRATITUDE_AMOUNT_MAX_PENCE) {
    return { ok: false, detail: "A placeholder amount must be between £1 and £500, or left blank." };
  }
  return { ok: true, amount: `${Math.floor(pence / 100)}.${String(pence % 100).padStart(2, "0")}` };
}

export function prepareGratitude(
  input: GratitudeInput,
  provider: GratitudePaymentProvider = placeholderGratitudePayments,
): PrepareResult {
  const honeypot = String(input.company ?? "").trim();
  const recipient = GRATITUDE_RECIPIENTS.find(r => r.id === String(input.recipientId ?? "").trim());
  if (!recipient) return { ok: false, detail: "Choose who this thanks is for." };

  const message = cleanMessage(input.message);
  if (message.length > GRATITUDE_LIMITS.message) {
    return { ok: false, detail: `Message must be ${GRATITUDE_LIMITS.message} characters or fewer.` };
  }
  const guestName = cleanName(input.guestName);
  if (guestName.length > GRATITUDE_LIMITS.name) {
    return { ok: false, detail: `Name must be ${GRATITUDE_LIMITS.name} characters or fewer.` };
  }

  const gestureRaw = String(input.gesture ?? "").trim();
  let gesture: PreparedGratitude["gesture"] = null;
  if (gestureRaw) {
    const found = GRATITUDE_GESTURES.find(g => g.id === gestureRaw);
    if (!found) return { ok: false, detail: "Choose a gesture from the list, or leave it blank." };
    gesture = { id: found.id, label: found.label };
  }

  const amount = parseGratitudeAmount(input.amount);
  if (!amount.ok) return amount;

  const prepared: PreparedGratitude = {
    recipient,
    message: message || null,
    guestName: guestName || null,
    anonymous: !guestName,
    gesture,
    amount: amount.amount,
    currency: "GBP",
    payment: provider.record({ amount: amount.amount, currency: "GBP" }),
    distributionStatus: "undecided",
  };
  return { ok: true, discarded: honeypot.length > 0, prepared };
}

export function gratitudeAck(prepared: PreparedGratitude, stored: boolean) {
  return {
    ok: true as const,
    stored,
    payment_status: prepared.payment.status,
    provider: prepared.payment.provider,
    provider_ref: prepared.payment.providerRef,
    distribution_status: prepared.distributionStatus,
    anonymous: prepared.anonymous,
    recipient: { id: prepared.recipient.id, kind: prepared.recipient.kind, label: prepared.recipient.label },
    message: prepared.message,
    guest_name: prepared.guestName,
    gesture: prepared.gesture ? { id: prepared.gesture.id, label: prepared.gesture.label } : null,
    amount: prepared.amount,
    currency: prepared.currency,
    notice: GRATITUDE_NOTICE,
  };
}

export async function acceptGratitude(opts: {
  prepared: PrepareResult;
  storeEnabled: boolean;
  save: (row: PreparedGratitude) => Promise<void>;
}): Promise<{ stored: boolean; body: ReturnType<typeof gratitudeAck> } | { error: string }> {
  if (!opts.prepared.ok) return { error: opts.prepared.detail };
  if (opts.prepared.discarded || !opts.storeEnabled) {
    return { stored: false, body: gratitudeAck(opts.prepared.prepared, false) };
  }
  await opts.save(opts.prepared.prepared);
  return { stored: true, body: gratitudeAck(opts.prepared.prepared, true) };
}
