/**
 * The only online charge is a stay deposit. Food is never a line item.
 * Payments stay off until PAYMENTS_ENABLED is set. A live secret key
 * still does not charge until PAYMENTS_LIVE is set.
 */

export const FOOD_IS_NOT_BILLED = "Food is not billed. The restaurant is buffet only.";

export const DEFAULT_DEPOSIT = {
  amount_gbp: 200,
  policy: "The house agrees the deposit when your place is accepted. Food is not billed.",
};

export function parseDepositSettings(raw: unknown): { amount_gbp: number; policy: string } {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const amount = Number(src.amount_gbp ?? DEFAULT_DEPOSIT.amount_gbp);
  const pounds = Number.isFinite(amount) ? Math.round(amount * 100) / 100 : DEFAULT_DEPOSIT.amount_gbp;
  const bounded = Math.min(100_000, Math.max(0, pounds));
  const policy = String(src.policy ?? DEFAULT_DEPOSIT.policy).trim().slice(0, 500) || DEFAULT_DEPOSIT.policy;
  return { amount_gbp: bounded, policy };
}

export function stripeChargeAllowed(input: { paymentsEnabled: boolean; secretKey: string; liveEnabled: boolean }):
  | { ok: true; mode: "test" | "live" }
  | { ok: false; status: 503; code: string; detail: string } {
  if (!input.paymentsEnabled) {
    return { ok: false, status: 503, code: "payments_disabled", detail: "Card payments are turned off. The house confirms the deposit. Food is not billed." };
  }
  if (input.secretKey.startsWith("sk_test_")) return { ok: true, mode: "test" };
  if (input.secretKey.startsWith("sk_live_")) {
    if (!input.liveEnabled) {
      return { ok: false, status: 503, code: "live_charges_disabled", detail: "Live card charges are off. A Stripe test key can be used first." };
    }
    return { ok: true, mode: "live" };
  }
  return { ok: false, status: 503, code: "stripe_not_configured", detail: "Set STRIPE_SECRET_KEY to a Stripe test key before taking a deposit." };
}

export function depositLine(input: { amountGbp: number; guest: string; house: string }): { name: string; description: string } {
  return {
    name: `Deposit — ${input.guest}`,
    description: `${input.house}. ${FOOD_IS_NOT_BILLED}`,
  };
}
