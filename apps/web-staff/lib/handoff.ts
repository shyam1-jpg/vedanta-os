/**
 * Pocket session handoff.
 * A session token may arrive only in the URL fragment (/pocket/#token=...).
 * Fragments are not sent to the server, so they stay out of access logs.
 * Query-string tokens are refused and stripped — they would be logged.
 * This module never writes logs.
 */

const TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;
const GENERIC = "Sign-in did not complete. Try again.";

export type HandoffResult =
  | { action: "none"; url: string; error: string | null }
  | { action: "store"; token: string; url: string }
  | { action: "reject"; url: string; message: string };

export type SignInOffer = "pending" | "email" | "microsoft" | "manager";

export function safeNotice(value: string | null | undefined): string | null {
  if (!value) return null;
  const one = value.replace(/[\r\n]/g, " ").trim();
  if (!one) return null;
  if (/token=/i.test(one) || TOKEN_RE.test(one)) return GENERIC;
  return one.slice(0, 300);
}

function pathnameOnly(pathname: string): string {
  return pathname && pathname.startsWith("/") ? pathname : "/pocket/";
}

/** True when the query string carries a session token. The value is not returned. */
export function queryCarriesToken(search: string): boolean {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  if (!raw) return false;
  const params = new URLSearchParams(raw);
  for (const key of params.keys()) {
    if (key.toLowerCase() === "token") return true;
  }
  return false;
}

function tokenFromHash(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw || !/(?:^|&)token=/.test(raw)) return null;
  const params = new URLSearchParams(raw);
  const value = params.get("token");
  return value == null ? null : value;
}

function searchWithoutSecrets(search: string): { search: string; error: string | null } {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  for (const key of [...params.keys()]) {
    if (key.toLowerCase() === "token") params.delete(key);
  }
  let error: string | null = null;
  if (params.has("error")) {
    const rawError = params.get("error");
    const safe = safeNotice(rawError);
    if (safe && rawError && safe === rawError.replace(/[\r\n]/g, " ").trim().slice(0, 300)) params.set("error", safe);
    else params.delete("error");
    error = safe;
  }
  const next = params.toString();
  return { search: next ? `?${next}` : "", error };
}

/**
 * Read a fragment handoff and return the history URL with the token removed.
 * The token is returned only for sessionStorage. It is never placed back on the URL.
 */
export function consumeSessionFragment(loc: { hash: string; search: string; pathname: string }): HandoffResult {
  const path = pathnameOnly(loc.pathname);
  if (queryCarriesToken(loc.search)) {
    return {
      action: "reject",
      url: path,
      message: "This sign-in link is not valid. Ask your manager for a new one.",
    };
  }
  const cleaned = searchWithoutSecrets(loc.search);
  const token = tokenFromHash(loc.hash);
  if (!token) return { action: "none", url: path + cleaned.search, error: cleaned.error };
  if (!TOKEN_RE.test(token)) {
    return {
      action: "reject",
      url: path + cleaned.search,
      message: "This sign-in link is not valid or has expired. Ask your manager for a new one.",
    };
  }
  return { action: "store", token, url: path + cleaned.search };
}

/**
 * Runs before React hydrates so the fragment is gone before the first paint.
 * Stores a valid token and leaves a note for the page when the link is refused.
 * The note is a fixed sentence, never the token.
 */
export const FRAGMENT_STRIP_SCRIPT = `(function(){try{var path=location.pathname&&location.pathname.charAt(0)==="/"?location.pathname:"/pocket/";var search=location.search||"";var hash=location.hash||"";var params=new URLSearchParams(search.charAt(0)==="?"?search.slice(1):search);var queryToken=false;params.forEach(function(_v,k){if(String(k).toLowerCase()==="token")queryToken=true;});if(queryToken){sessionStorage.setItem("vedanta.staff.handoff-note","This sign-in link is not valid. Ask your manager for a new one.");history.replaceState(null,"",location.origin+path);return;}var raw=hash.charAt(0)==="#"?hash.slice(1):hash;if(!raw||!(/(?:^|&)token=/).test(raw))return;var token=new URLSearchParams(raw).get("token")||"";if(!/^[A-Za-z0-9_-]{20,128}$/.test(token)){sessionStorage.setItem("vedanta.staff.handoff-note","This sign-in link is not valid or has expired. Ask your manager for a new one.");history.replaceState(null,"",location.origin+path+search);return;}sessionStorage.setItem("vedanta.staff.token",token);sessionStorage.setItem("vedanta.staff.handoff-from-link","1");history.replaceState(null,"",location.origin+path+search);}catch(e){}})();`;

/** What Pocket should offer. Email is shown only when the API says email sign-in is enabled. */
export function pocketSignInOffer(providers: { email?: boolean; microsoft?: boolean } | null): SignInOffer {
  if (!providers) return "pending";
  if (providers.email) return "email";
  if (providers.microsoft) return "microsoft";
  return "manager";
}
