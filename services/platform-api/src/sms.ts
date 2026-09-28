/** Text messages. Off unless a Twilio account, token and from-number are set. */
import { smsConfigured, type SmsEnv } from "../../../domains/guest/feedback.ts";

export async function deliverSms(
  env: SmsEnv,
  msg: { to: string; body: string },
  fetchImpl: typeof fetch = fetch,
): Promise<"disabled" | "sent" | "failed"> {
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
