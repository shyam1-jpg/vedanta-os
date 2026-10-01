/**
 * Production rules for opening a new My Stay.
 * A typed email is not a session. The guest must prove they can read a one-time
 * code sent to that address. ALLOW_UNVERIFIED_GUEST_BOOTSTRAP is a separate,
 * explicit bypass and stays off in production.
 */

export const EMAIL_ALREADY_ON_BOOK =
  "For your privacy, this email must sign in to My Stay before it can be used again.";
export const EMAIL_CODE_REQUIRED =
  "Enter the code we emailed to you before opening My Stay. Request a code if you do not have one yet.";
export const EMAIL_CODE_INVALID =
  "That email code is invalid or has expired. Request a new one.";
export const EMAIL_CODE_SENT =
  "If this address can open a new My Stay, we have emailed a code. It expires in 10 minutes. Check your inbox and junk folder.";
export const EMAIL_CODE_UNAVAILABLE =
  "We could not email a code right now. Please try again later, or write to the house.";

export type GuestSignupPath = "/guest/register" | "/guest/enquiries";

export type GuestSignupGate =
  | { action: "allow" }
  | { action: "require_email_code" }
  | { action: "reject"; status: 409; code: "guest_identity_verification_required"; detail: string };

export function normalizeGuestEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/** Message for an incomplete form. Returned before a code is consumed. */
export function guestSignupValidationDetail(path: GuestSignupPath, body: {
  name?: unknown;
  email?: unknown;
  people?: unknown;
  programme_id?: unknown;
  arrival?: unknown;
  departure?: unknown;
} | null | undefined): string {
  const email = normalizeGuestEmail(body?.email);
  const name = String(body?.name ?? "").trim();
  const emailOk = email.includes("@") && email.length <= 254;
  if (path === "/guest/register") return "Name and email are required";
  if (!name || !emailOk || !(Number(body?.people) > 0)) return "Name, email and number of people are required";
  const arrival = String(body?.arrival ?? "").trim();
  const departure = String(body?.departure ?? "").trim();
  if (!body?.programme_id && (!arrival || !departure)) return "Choose a programme, or give arrival and departure dates";
  if (!body?.programme_id && departure < arrival) return "Departure must be on or after arrival";
  return "Name, email and number of people are required";
}

/** Same acceptance the register and enquiry routes use before creating an account. */
export function guestSignupPayloadReady(path: GuestSignupPath, body: {
  name?: unknown;
  email?: unknown;
  people?: unknown;
  programme_id?: unknown;
  arrival?: unknown;
  departure?: unknown;
} | null | undefined): boolean {
  const email = normalizeGuestEmail(body?.email);
  const name = String(body?.name ?? "").trim();
  if (!name || !email.includes("@") || email.length > 254) return false;
  if (path === "/guest/register") return true;
  const people = Number(body?.people);
  if (!(people > 0)) return false;
  if (body?.programme_id) return true;
  const arrival = String(body?.arrival ?? "").trim();
  const departure = String(body?.departure ?? "").trim();
  return !!arrival && !!departure && departure >= arrival;
}

/**
 * Decide whether a register or enquiry request may create a guest account.
 * An existing address can only continue when this request's session already
 * owns that My Stay (enquiries). A brand-new address in production must
 * present a matching email code. A bearer token by itself is not that proof.
 */
export function guestSignupGate(input: {
  production: boolean;
  allowUnverifiedBootstrap: boolean;
  path: GuestSignupPath;
  existingAccount: boolean;
  sessionOwnsAccount: boolean;
}): GuestSignupGate {
  if (input.existingAccount) {
    if (input.path === "/guest/enquiries" && input.sessionOwnsAccount) return { action: "allow" };
    return {
      action: "reject",
      status: 409,
      code: "guest_identity_verification_required",
      detail: EMAIL_ALREADY_ON_BOOK,
    };
  }
  if (!input.production || input.allowUnverifiedBootstrap) return { action: "allow" };
  return { action: "require_email_code" };
}
