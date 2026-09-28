/**
 * Where a freshly issued browser session is handed over.
 * The token is placed in the URL fragment only, matching the admin sign-in page.
 * Fragments are not sent on the next request and must not be logged by callers.
 */

export type HandoffAudience = "ADMIN" | "STAFF";

const TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;

export function audienceFromSurface(surface: unknown): HandoffAudience {
  const value = Array.isArray(surface) ? surface[0] : surface;
  return typeof value === "string" && value.trim().toLowerCase() === "staff" ? "STAFF" : "ADMIN";
}

/** OAuth `state` prefix. Used only to send a failed attempt back to the right door. */
export function stateForAudience(audience: HandoffAudience, nonce: string): string {
  return `${audience === "STAFF" ? "s" : "a"}.${nonce}`;
}

export function audienceFromState(state: unknown): HandoffAudience | null {
  const value = Array.isArray(state) ? state[0] : state;
  if (typeof value !== "string") return null;
  if (value.startsWith("s.")) return "STAFF";
  if (value.startsWith("a.")) return "ADMIN";
  return null;
}

function originOf(web: string): string {
  return web.replace(/\/$/, "");
}

/** Pocket lives at /pocket/ on the shared web origin, unless STAFF_WEB_URL already points there. */
export function pocketBase(web: string, staffWeb?: string): string {
  const staff = originOf(staffWeb ?? process.env.STAFF_WEB_URL ?? web);
  if (staff.endsWith("/pocket")) return staff;
  return `${staff}/pocket`;
}

export function sessionHandoffLocation(
  audience: HandoffAudience,
  token: string,
  web = process.env.WEB_URL ?? "http://localhost:3000",
  staffWeb?: string,
): string {
  if (!TOKEN_RE.test(token)) throw new Error("refusing to redirect with an unsafe session token");
  if (audience === "STAFF") return `${pocketBase(web, staffWeb)}/#token=${token}`;
  return `${originOf(web)}/sign-in/#token=${token}`;
}

export function sessionErrorLocation(
  audience: HandoffAudience,
  why: string,
  web = process.env.WEB_URL ?? "http://localhost:3000",
  staffWeb?: string,
): string {
  const one = why.replace(/[\r\n]/g, " ").trim();
  const message = !one || /token=/i.test(one) || TOKEN_RE.test(one)
    ? "Sign-in did not complete. Try again."
    : one.slice(0, 300);
  const q = `?error=${encodeURIComponent(message)}`;
  if (audience === "STAFF") return `${pocketBase(web, staffWeb)}/${q}`;
  return `${originOf(web)}/sign-in/${q}`;
}
