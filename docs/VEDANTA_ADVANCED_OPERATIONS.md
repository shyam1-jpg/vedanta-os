# Vedanta connected operations — implementation and release notes

## Purpose

Extend the existing Vedanta OS with connected workflows inspired by RMS Cloud,
hotelkit, Lightspeed and Duve. These are independently implemented features,
not integrations with those vendors or copies of their designs.

Reference pages reviewed 1 October 2026:
- https://www.rmscloud.com/blog/hotel-automation
- https://hotelkit.net/
- https://www.lightspeedhq.com/uk/pos/restaurant/
- https://duve.com/

## Delivered

| Area | Behaviour |
|---|---|
| Task command centre /tasks/ | List/board views, explainable triage, loaded-list search/focus, house totals, department work volume, templates, blockers, assignment and printing. |
| Retreat readiness /readiness/ | Live booking, current room conditions, service-specific meal covers, linked task verification and blockers, reviewed plan history. |
| Change impact review | Compares booking dates, slots, counts, meal boundaries, dietary notes and status with the last reviewed snapshot. Shows old/new values without changing bookings, shifts or purchases. |
| Department workflow packs | Eight editable drafts: front desk, housekeeping, kitchen, restaurant, maintenance, grounds, night and management. Manager reviews owners, estimates, deadlines and note, then creates the whole pack atomically. |
| Staff Pocket /pocket/ | Open/mine task views; instructions, active SOPs, notes, photos, status/blocker actions and history. Handovers can be acknowledged with actor/time. Equipment tab supports QR entry. |
| Guest book /book/ | Own-stay arrival checklist and published programme schedule. Existing dietary/access/arrival updates now enqueue changes for staff review. |
| Guest updates /guest-changes/ | Role-gated before/after guest detail review queue. A review note is required and retained with reviewer/time and audit event. |
| Equipment /assets/ | Existing asset registry and service history, locally generated QR labels linking to staff equipment records, approved manual reference editor and print action. |

## Important behaviour

- The source booking version is required when creating packs. Stale submissions
  fail with 409; the manager reloads and reviews current data.
- A unique property/booking/version/kind key makes successful retries idempotent.
  A booking row lock serialises competing submissions. All tasks, their opening
  events, the snapshot and audit entry are written in one database transaction.
- Existing tasks/history are preserved. Readiness checks ALL booking-linked work,
  including blockers in older packs. Obsolete work must be cancelled by a manager;
  the code does not silently supersede outstanding work.
- Readiness is recorded preparation, not a safety certificate or allergy clearance.
  Completed tasks need verification; current room states do not predict future room readiness.
- Templates contain illustrative work estimates. This is not a rota capacity
  forecast. Enter deadlines in device-local time; timestamps are sent as UTC and
  displayed in Europe/London.
- Guest schedules require ownership of an enquiry linked to a booking, and only
  published programme items inside that stay are returned. Internal programme
  notes, staff names and department work lists are excluded.
- Guest detail edits and their review queue entry are atomic. Identical retries
  do not add another change. The queue is restricted by guest.read; acknowledgement
  requires guest.write. Updates are declarations, not dietary approvals.
- QR links carry an asset UUID, never credentials or guest details. Staff sign-in
  is required. Pocket preserves the requested equipment selection across sign-in.
  Staff equipment responses omit financial and serial-number fields.
- Existing Parslia integration feed remains the kitchen interface. This release
  uses the existing covers rules and links kitchen, rota and purchasing workspaces.

## Database and release

Apply additive migration `0039_retreat_workflows.sql`. It creates workflow runs,
handovers acknowledgements and guest detail changes, adds task workflow_run_id
and asset sop_slug, and adds indexes. It does not rewrite existing bookings or tasks.

Deploy API and all three static apps together (`npm run build:web-bundle`). Existing
Render startup runs migration files through the established migration runner.
No production secrets, authentication flags, integration keys or permissions are
changed by this release. This branch does not issue live guest communications.

Validation includes domain rules, real PostgreSQL-engine (PGlite) transactional
workflow checks, guest API ownership/privacy tests and staff asset scope/access
checks. Test fixtures are synthetic; production records are not accessed.

Before production release, run signed-in acceptance for manager pack creation,
booking-change review, staff task evidence, handover acknowledgement, guest needs
review, published schedules and QR scanning/printing. The live site requires
Microsoft 365 sign-in and has not been authenticated or changed in this session.

## Remaining external connections

Live supplier-price collection, Parslia recipe scaling/stock deductions, external
rota writeback, paid messaging channels, POS/room billing, mobile locks and sensors
require the relevant service configuration and agreed data contracts. They are not
represented as connected here. Room readiness and allergen decisions remain with
authorised staff. No RMS/hotelkit/Lightspeed/Duve subscription is purchased.
