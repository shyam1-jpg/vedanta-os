/**
 * What the house queues after a booking is confirmed, and who hears about a new enquiry.
 * Organiser name lives on the person record. The website lives in property settings.
 */

export const ORGANISER_NAME_SQL = `nullif(trim(p.given_name || ' ' || coalesce(p.family_name, '')), '') AS contact_name`;

export const PROPERTY_WEBSITE_SQL = `coalesce(settings->>'website','https://www.thevedanta.org/') AS website`;

const DAY = 86_400_000;

export function plannedComms(input: { now: Date; arrival: Date; departure: Date }): { kind: string; when: Date }[] {
  const schedule = [
    { kind: "booking_confirmed", when: input.now },
    { kind: "balance_reminder", when: new Date(input.arrival.getTime() - 14 * DAY) },
    { kind: "pre_arrival", when: new Date(input.arrival.getTime() - 7 * DAY) },
    { kind: "checkout_reminder", when: input.departure },
  ];
  return schedule.filter(item => item.kind === "booking_confirmed" || item.when >= input.now);
}

export function staffAlertAddresses(settings: unknown): string[] {
  const src = settings && typeof settings === "object" ? settings as Record<string, any> : {};
  const front = src.booking_routing?.front?.email;
  const manager = src.fault_routing?.manager ?? src.fault_routing?.gm ?? src.fault_routing?.gm_email;
  const out: string[] = [];
  for (const email of [front, manager]) {
    if (typeof email === "string" && email.includes("@") && !out.includes(email)) out.push(email);
  }
  return out;
}

export function staffNewEnquiryLetter(enquiry: { name: string; email: string; arrival: string; departure: string; people: number }): { subject: string; body: string } {
  return {
    subject: `New enquiry — ${enquiry.name}`,
    body: `A guest saved a place.\n\nName: ${enquiry.name}\nEmail: ${enquiry.email}\nDates: ${enquiry.arrival} to ${enquiry.departure}\nPeople: ${enquiry.people}\n\nFood is not billed. Open the house book to take the enquiry.\n`,
  };
}
