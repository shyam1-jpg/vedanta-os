/**
 * Card payments stay in the codebase and stay off until PAYMENTS_ENABLED=true.
 * The house restaurant is buffet only. Food is not billed. The only till on the
 * roadmap is the reception shop, which is a later phase.
 * Card numbers and CVVs are never stored. Stripe Checkout holds the card.
 */

const CARD_KEYS = new Set(["number", "pan", "cvv", "cvc", "card_number", "security_code", "cardnumber"]);

export function paymentsEnabled(): boolean {
  return ["1", "true", "yes", "on"].includes((process.env.PAYMENTS_ENABLED ?? "").trim().toLowerCase());
}

export function bodyHasCardData(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (CARD_KEYS.has(key.toLowerCase().replace(/[\s_-]/g, ""))) return true;
    if (bodyHasCardData(value)) return true;
  }
  return false;
}

/** What we keep from a Stripe event: ids and amounts, never a card. */
export function stripeAuditPayload(event: { id?: unknown; type?: unknown; data?: { object?: Record<string, unknown> } }): Record<string, unknown> {
  const session = event.data?.object ?? {};
  return {
    id: event.id ?? null,
    type: event.type ?? null,
    payment_intent: session.payment_intent ?? null,
    amount_total: session.amount_total ?? null,
    metadata: session.metadata ?? null,
  };
}
