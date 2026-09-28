# Vedanta system upgrade: guest, house and staff

This is a staged product build for `/book/`, `/house/` and `/pocket/`. All three surfaces should share the estate identity, accessible controls and one source of operational truth. A visual change is complete only when the related task works on mobile and desktop.

## Release 1 — Trust and one visual language

- Guest: public retreats exclude internal records; availability explains counts and date range; guests can express bed and access preferences; enquiries state the real commercial position. Concept imagery is labelled as illustrative.
- House: a clear live command centre, arrivals/departures, room readiness, kitchen covers, open tasks and exceptions, with links to act on them.
- Staff: a mobile first shift view with clock state, assigned work, handover and a fast route to SOPs. Staff see only the information their role needs.
- Acceptance: all portals build together; the public test listing is absent; keyboard and phone layouts work; an unavailable API shows a useful recovery state.

## Release 2 — Booking and guest journey

- Structured package and room prices, currencies, inclusions and capacity rules. A quote must state its basis, taxes, deposit and balance; no totals are inferred from free text.
- Versioned cancellation/refund terms, accepted before payment, with an audit trail and a receipt. Payment happens only after the house has agreed an amount.
- Programme details: schedule, host, meals, room options and remaining places. Staff publish explicit public fields; private group notes never flow into guest copy.
- Waitlist with capacity and expiry rules, explicit invitation and a time-limited offer. No silent auto-booking.
- My Stay: itinerary, arrival details, dietary and accessibility updates, messages and booking status. Sensitive updates surface to the responsible staff member.

## Release 3 — One operational plan

- Confirmed booking becomes a single operating sheet for reception, housekeeping, restaurant, kitchen and duty manager. Each department sees its tasks and deadlines.
- Kitchen forecast counts breakfast, lunch and dinner by date, including partial arrival/departure days; dietary and allergen declarations have a named review/acknowledgement path.
- Room allocation checks conflicts, out-of-order state and accessibility needs before confirmation; changes update housekeeping and reception.
- Staff rota compares expected covers and occupancy with scheduled coverage, contracted hours and open gaps. Managers approve swaps; staff see their own shifts.
- Purchasing turns approved menu forecasts and existing stock into suggested quantities, while a human reviews supplier orders.

## Release 4 — Assisted intelligence

- AI duty brief uses only current, permissioned house data and cites the source record and timestamp for every recommendation.
- Suggestions: occupancy and cover anomalies, missing dietary sign-off, likely rota gaps, stock reorder points, maintenance recurrence and late tasks.
- No AI-generated price, allergy clearance, contract term, staff decision or automatic payment. Staff approve consequential actions and can correct the underlying record.
- Measure: time from guest change to kitchen acknowledgement, room conflict rate, missed handovers, forecast error and guest enquiry conversion.

## Decisions needed before later releases

The house must approve its room/package price list, tax treatment, deposit/refund terms, programme publication fields, waitlist policy, and who may view sensitive guest needs. Until then, the public site should invite an enquiry and state that price and terms will be confirmed by the house.
