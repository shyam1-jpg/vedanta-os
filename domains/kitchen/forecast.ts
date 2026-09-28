/** Firm covers are provisional, confirmed, or in house. An enquiry is visible and not counted. */

export function countTowardCovers(status: string): boolean {
  return status === "PROVISIONAL" || status === "CONFIRMED" || status === "IN_HOUSE";
}

export function isUnconfirmedStay(status: string): boolean {
  return status === "ENQUIRY";
}
