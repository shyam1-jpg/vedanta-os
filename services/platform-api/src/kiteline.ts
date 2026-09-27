/**
 * Optional guest-event pointer for Kiteline. Off unless KITELINE_BACKUP=true.
 * When on, every request is HMAC-signed and carries only an id and an event type.
 * Names, emails, phones and notes are never sent.
 */
import { createHmac } from "node:crypto";

const BASE = () => (process.env.KITELINE_URL ?? "https://kiteline.uk").replace(/\/$/, "");

export function kitelineEnabled(): boolean {
  const v = (process.env.KITELINE_BACKUP ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function minimumGuestEvent(event: { id?: unknown; kind?: unknown; [k: string]: unknown }): { id: string; kind: string } | null {
  const id = String(event.id ?? "").trim();
  const kind = String(event.kind ?? "").trim();
  if (!id || !kind) return null;
  return { id, kind };
}

export function signKitelineBody(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function buildKitelineRequest(
  event: { id?: unknown; kind?: unknown; [k: string]: unknown },
  secret: string,
  now = new Date(),
): { url: string; body: string; timestamp: string; signature: string } | null {
  const ref = minimumGuestEvent(event);
  if (!ref || secret.length < 16) return null;
  const body = JSON.stringify(ref);
  const timestamp = now.toISOString();
  return {
    url: `${BASE()}/api/vedanta/patch`,
    body,
    timestamp,
    signature: `sha256=${signKitelineBody(secret, timestamp, body)}`,
  };
}

export async function backupGuestEvent(event: { id: string; kind: string; [k: string]: unknown }): Promise<void> {
  if (!kitelineEnabled()) return;
  const secret = process.env.KITELINE_SECRET ?? "";
  const req = buildKitelineRequest(event, secret);
  if (!req) {
    console.warn("kiteline backup skipped: set KITELINE_SECRET (at least 16 characters) and an id plus event type");
    return;
  }
  try {
    const res = await fetch(req.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-vedanta-timestamp": req.timestamp,
        "x-vedanta-signature": req.signature,
      },
      body: req.body,
    });
    if (!res.ok) console.warn("kiteline backup failed", res.status);
  } catch (e) {
    console.warn("kiteline backup unreachable", (e as Error).message);
  }
}
