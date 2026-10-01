export const API = process.env.NEXT_PUBLIC_API_URL ?? "";
export const tok = {
  get: () => (typeof window === "undefined" ? null : sessionStorage.getItem("vedanta.staff.token")),
  set: (t: string | null) => { if (t) sessionStorage.setItem("vedanta.staff.token", t); else sessionStorage.removeItem("vedanta.staff.token"); },
};
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(init.headers as Record<string, string> ?? {}) };
  const t = tok.get(); if (t) headers.authorization = `Bearer ${t}`;
  const res = await fetch(API + path, { ...init, headers });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? res.statusText);
  return body as T;
}

