# Vedanta advanced operations programme

## Goal

One retreat record should drive the work of front desk, housekeeping, kitchen,
restaurant, maintenance, grounds, night porter and management. Staff should see
what to do, where, by when, the accountable owner, the approved procedure,
blocking issues and evidence of completion. Managers should see exceptions and
proposed responses with source data. Worldwide uniqueness is not a verifiable
acceptance criterion; reliable Vedanta workflows are.

## Delivered in this change

The existing /tasks/ route becomes an operations command centre, keeping the
current API commands, task state machine, permissions, photos and history.

- Whole-house totals and explicit loaded-list scope.
- List and grouped workflow board, search, attention/deadline/newest sorting.
- Focus on London-date deadlines, blockers, approval, missing owner and critical severity.
- Department work volume from entered estimates, with missing estimates reported.
- Nine editable department task templates; selecting one creates no records.
- Deadline, estimate, severity, equipment, retreat and SOP inputs.
- Manager owner reassignment and recording a reason when blocking work.
- Printable handover and links to existing department workspaces.
- API open-status filter and matched count for loading further pages.
- Protection against out-of-order responses replacing the selected task or department.

Attention is deterministic and explainable, not an AI forecast. Search and workload
summaries cover loaded tasks. The page displays the matched total and a load-more
control; it does not claim an unloaded list is complete. London display dates are
separate from deadline entry, which uses the device local timezone and sends UTC.
Templates contain illustrative estimates that staff must review.

## Next delivery stages and acceptance gates

| Stage | Concrete behaviour | Gate before release |
|---|---|---|
| 1. Unified event links | Link tasks to existing booking, room, asset and service records by ID; show source and deep link. | Property isolation; no duplicate guest records; links resolve under the viewer's permissions. |
| 2. Retreat change review | A change in confirmed dates, guest count or dietary requirements produces a preview of affected department tasks. | Show old/new values, source version, reviewer and reasons; retries do not duplicate work. |
| 3. Workflow packs | Manager previews an arrival, departure or meal-service pack, edits owners/deadlines, then creates linked tasks. | Atomic creation and idempotency; preserve SOP versions; never auto-approve safety or allergen decisions. |
| 4. Staffing scenarios | Show required work minutes against confirmed shift availability and skill/role constraints. | Use authoritative rota data; show missing coverage; manager approves shift changes. |
| 5. Purchasing intelligence | Stock plus confirmed meal demand generates order proposals and comparable supplier offers. | Match pack size, units, VAT, delivery, minimum orders and expiry; show price timestamp and source; approval before purchase. |
| 6. Equipment readiness | Asset records link fault history, inspection due dates, SOP and service follow-up to department readiness. | Follow authorised safe-use restrictions; competent sign-off before returning failed equipment to service. |
| 7. Mobile completion | Pocket receives shared task details, blockers, photo evidence and handover acknowledgements. | Offline commands carry idempotency keys and versions; conflict resolution preserves audit history. |
| 8. Management intelligence | A daily exception brief cites operational records and proposes actions with estimated impact. | No invented financial savings, staff capacity or safety status; role-scoped context and human review. |

## Example target journey

A retreat's confirmed count changes from 30 to 20. The system shows the booking
version and affected meal counts, rooms, service preparation, planned work and
orders. Department managers review the proposals. Approved changes record who
approved them and why; affected staff receive the resulting task updates through
the chosen communications channel. No automatic shift cancellation or dietary
substitution is implied.

## Data and technical approach

Extend the Fastify API, Postgres schema and existing Next static apps. Parslia
remains the kitchen specialist and existing staffing tools remain authoritative.
Use additive migrations for source IDs, dependencies, recurrence, template
versions and command idempotency. Add due-date reminders only after selecting a
channel and ensuring they deduplicate, respect quiet hours and retain delivery
state. A QR asset label may open an existing asset page; it must not disclose
private guest or employee data.

## Current validation and limitations

Domain tests cover triage, lifecycle lanes, search, London midnight/DST and
closed-task handling. Production build verifies frontend compilation and types.
Live authenticated acceptance and database-backed API checks still need a test
session/database. The live page currently redirects this browser to Microsoft
365 sign-in. This change does not alter authentication or make the dashboard public.

Release the API and admin app together for matched_total and the open filter.
Deploy from the reviewed branch; a pull request alone does not change the live site.
