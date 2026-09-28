/**
 * Who may save a place on /book.
 * A header that merely starts with "Bearer" is not a session.
 * Production stays closed to unverified guests until ALLOW_UNVERIFIED_GUEST_BOOTSTRAP
 * is turned on. A guest who has already proved their email can book without that flag.
 */

export type GuestSessionProof = { email: string; verified: boolean };

export type GateDecision =
  | { ok: true }
  | { ok: false; status: 401 | 403 | 503; code: string; detail: string };

export const BOOKING_CLOSED = "Online booking is not open yet. You can still look at programmes and dates. Contact the house to save a place, or sign in if you already have an access code.";

export function cleanIdempotencyKey(raw: unknown): string | null {
  const key = String(raw ?? "").trim();
  if (!/^[A-Za-z0-9._:-]{8,80}$/.test(key)) return null;
  return key;
}

export function formatBookingReference(raw: string): string {
  const clean = raw.replace(/[^a-f0-9]/gi, "").slice(0, 8).toUpperCase();
  return `BK-${clean.padEnd(8, "0")}`;
}

/** Register may create an account. It may hand back a session only outside production, or when the unverified bootstrap flag is on. */
export function issueSessionOnRegister(production: boolean, allowUnverifiedBootstrap: boolean): boolean {
  return !production || allowUnverifiedBootstrap;
}

export function decideBookingGate(input: {
  route: "register" | "enquiry";
  production: boolean;
  allowUnverifiedBootstrap: boolean;
  tokenPresented: boolean;
  session: GuestSessionProof | null;
  bodyEmail: string;
  accountExists: boolean;
}): GateDecision {
  if (input.tokenPresented && !input.session) {
    return { ok: false, status: 401, code: "unauthenticated", detail: "That sign-in is not valid. Request a new access code, or contact the house." };
  }
  if (input.accountExists) {
    const same = !!input.session && input.session.email === input.bodyEmail;
    if (!same) {
      return {
        ok: false,
        status: 409,
        code: "guest_identity_verification_required",
        detail: "For your privacy, this email must sign in to My Stay before it can be used again.",
      };
    }
  }
  if (input.route === "register") return { ok: true };

  if (input.allowUnverifiedBootstrap || !input.production) {
    if (input.session && input.bodyEmail && input.session.email !== input.bodyEmail) {
      return { ok: false, status: 403, code: "email_mismatch", detail: "Sign in with the same email you are booking under." };
    }
    return { ok: true };
  }

  if (!input.session) {
    return { ok: false, status: 503, code: "guest_email_verification_required", detail: BOOKING_CLOSED };
  }
  if (!input.session.verified) {
    return { ok: false, status: 403, code: "email_not_verified", detail: "Verify your email with the access code before saving a place." };
  }
  if (input.bodyEmail && input.session.email !== input.bodyEmail) {
    return { ok: false, status: 403, code: "email_mismatch", detail: "Sign in with the same email you are booking under." };
  }
  return { ok: true };
}

export function publicBookingOpen(input: {
  production: boolean;
  allowUnverifiedBootstrap: boolean;
  sessionVerified: boolean;
}): { open: boolean; code: string; detail: string } {
  if (!input.production || input.allowUnverifiedBootstrap || input.sessionVerified) {
    return { open: true, code: "open", detail: "You can save a place." };
  }
  return { open: false, code: "guest_email_verification_required", detail: BOOKING_CLOSED };
}
