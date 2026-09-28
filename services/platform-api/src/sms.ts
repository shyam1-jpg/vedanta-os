/** Text messages. Off unless a Twilio account, token and from-number are set. */
import { smsConfigured, type SmsEnv } from "../../../domains/guest/feedback.ts";

export async function deliverSms(
  env: SmsEnv,
  msg: { to: string; body: string; kind?: string; email?: string; tenantId?: string; propertyId?: string; audience?: "guest" | "staff"; urgent?: boolean },
  fetchImpl: typeof fetch = fetch,
): Promise<"disabled" | "sent" | "failed" | "skipped" | "deferred"> {
  if (msg.kind && msg.tenantId && msg.propertyId) {
    try {
      const { gateOutbound } = await import("./commsPrefs.ts");
      const decision = await gateOutbound({
        tenantId: msg.tenantId,
        propertyId: msg.propertyId,
        to: msg.to,
        email: msg.email,
        kind: msg.kind,
        channel: "sms",
        audience: msg.audience,
        urgent: msg.urgent,
      });
      if (decision.action === "skip") return "skipped";
      if (decision.action === "defer") {
        await import("./db.ts").then(({ pool }) => pool.query(
          `insert into outbound_email (tenant_id, property_id, to_email, subject, body, kind, status, channel, not_before, hold_reason, guest_email)
           values ($1,$2,$3,'Text',$4,$5,'DEFERRED','sms',$6,$7,$8)`,
          [msg.tenantId, msg.propertyId, msg.to, msg.body, msg.kind, decision.notBefore ?? null, decision.reason, msg.email ?? null],
        )).catch(() => {});
        return "deferred";
      }
    } catch {
      /* A missing preference table must not drop a message the house has already decided to send. */
    }
  }
  if (!smsConfigured(env)) return "disabled";
  const sid = env.TWILIO_ACCOUNT_SID!.trim();
  const auth = Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN!.trim()}`).toString("base64");
  const body = new URLSearchParams({ To: msg.to, From: env.TWILIO_FROM!.trim(), Body: msg.body });
  try {
    const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST",
      headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
