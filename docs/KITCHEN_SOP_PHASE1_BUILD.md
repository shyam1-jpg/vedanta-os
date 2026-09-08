# Vedanta Way Ltd — Kitchen SOP & Operations
## Phase 1 Build Brief

Status: implementation brief for Cursor / developer agent
Branch: `cursor/vedanta-sop-operations-v1`

## Objective
Build the first usable version of the Vedanta kitchen SOP operating layer inside the existing Vedanta OS.

Do not create a separate product or duplicate Parslia. Phase 1 is focused on staff execution, SOP access, shift checks, temperatures, cleaning, equipment records, corrective actions, and offline-capable Pocket access.

## First task: inspect before editing
Before coding, inspect:
- current `apps/web-staff` routes/components
- current `apps/web-admin` routes/components
- `services/platform-api` routing/auth/audit patterns
- current migrations and next unused migration number
- existing permissions and role seeds
- any existing `/sops/`, `/manual/`, `/tasks/`, `/compliance/`, `/kitchen/`, `/maintenance/` code
- existing OpenAPI contract locations
- current static-export limitations
- current deployment bundle

Write a short implementation note in this document or a new `docs/kitchen-sop-implementation-notes.md` listing what already exists and what will be reused.

## Phase 1 user journeys

### A. Kitchen staff: Today
A kitchen staff member opens Pocket and sees a kitchen operations home view with:
- current date
- current/next service if available from existing cover data
- cover count if available
- assigned/open shift checklist
- tasks due
- temperature checks due
- cleaning checks due
- unresolved corrective actions assigned/visible to them
- training due may be placeholder if training model is Phase 2

This screen must work well on phone and tablet.

### B. Kitchen staff: My Shift
Staff can open a shift instance, for example Opening or Closing, and execute ordered checklist items.
Each item can record its configured input type.

Minimum Phase 1 input types:
- acknowledgement/check
- pass/flag/fail
- number
- temperature
- text note
- timestamp/start-complete timer

Photo/media capture can be added if existing app patterns make it low-risk; otherwise model it and defer UI.

### C. Kitchen staff: Temperature check
Staff choose/receive a configured check, enter a temperature, and immediately see:
- within range: success
- outside range: clear exception state

Outside-range readings must create or require a corrective-action record before the workflow can be considered resolved.
Never discard the original reading.

### D. Kitchen staff: SOP viewer
Staff can browse/search approved SOPs by category and open a clean step-by-step mobile view.
Only approved/current SOP versions should be presented as normal operational guidance.
Draft/review versions are manager-only.

### E. Kitchen staff: Equipment quick guide
Staff can open an equipment record or QR deep link and see:
- equipment identity
- status
- linked approved SOPs
- manual link if available
- safety quick links
- report fault action linking into existing maintenance if practical

### F. Manager: SOP administration
Manager can:
- create/edit draft SOP metadata
- create/edit ordered steps
- move SOP to review
- approve/publish with permission
- retire a version
- see version history

Never mutate an already-used published SOP version in a way that changes historical records. Use versioning.

### G. Manager: equipment register
Manager can create/edit equipment records including:
- ID
- name
- manufacturer
- model
- serial
- location
- status
- manual URL/reference
- QR token/deep-link identifier
- notes

Do not add model-specific SOP content automatically.

## Proposed domain/data concepts
Use repository naming conventions after inspection. Suggested concepts only:

### `sop`
Stable logical SOP identity.
Fields may include:
- id
- tenant_id
- property_id
- sop_code
- title
- category
- area
- owner_department
- status
- current_version_id
- created_at
- created_by

### `sop_version`
Immutable/revision-oriented content version.
- id
- sop_id
- revision
- purpose
- estimated_minutes
- hazards_json or normalized relation if preferred by existing patterns
- ppe_json
- approval state
- issued_at
- review_due_at
- approved_at
- approved_by

### `sop_step`
Ordered reusable step rows.
- id
- sop_version_id
- sort_order
- title
- instruction
- step_type
- required
- config_json
- media metadata/reference
- corrective_action_policy

### `equipment_asset`
If an existing asset model is present, extend/reuse it instead of creating this table.
Minimum fields:
- id
- tenant_id
- property_id
- equipment_code
- name
- manufacturer
- model
- serial_number
- location
- status
- manual_reference
- qr_token
- metadata

### `equipment_sop_link`
Equipment-to-SOP relationship.

### `shift_template`
Reusable opening/closing/etc template.

### `shift_template_item`
Ordered template items that can reference SOP steps/check types.

### `shift_instance`
A dated operational run.

### `shift_item_result`
Execution record with actor/time/result and preserved template/SOP version reference.

### `temperature_check_definition`
Configuration for a location/process check.
- name
- scope/type
- unit
- minimum/maximum or rule JSON
- active version/effective date
- required corrective action policy

### `temperature_reading`
Immutable original reading.

### `corrective_action`
Reusable exception workflow that can link to readings, shift items, deliveries, equipment or other operational records later.
Minimum:
- source_type/source_id
- status
- severity
- description
- immediate_action
- assigned_to
- opened_at/by
- resolved_at/by
- verification_required
- verified_at/by

### `cleaning_template` / `cleaning_instance`
If the generic shift/task engine can model cleaning well, reuse it rather than introducing duplicate tables.

## API principles
Follow existing `/v1/*` route style and command semantics.

Suggested route families after matching existing conventions:
- `GET /v1/sops`
- `GET /v1/sops/:id`
- SOP draft/version command endpoints
- `GET /v1/kitchen/today`
- `GET /v1/kitchen/shifts/...`
- shift start/complete/record commands
- `GET /v1/kitchen/temperature-checks`
- command to submit reading
- corrective-action commands
- `GET /v1/equipment`
- `GET /v1/equipment/:id-or-qr`

Do not implement routes that conflict with existing names without checking first.

## Permissions
Reuse existing `sop.read/write`, `kitchen.read/write`, `maintenance.*`, `task.*`, `compliance.*` where semantically correct.
Add only permissions that are genuinely missing, for example an explicit SOP approval permission if needed.
All additions must be additive and seeded idempotently.

## PWA / offline Phase 1
Implement the smallest safe installable/offline foundation for `apps/web-staff`:
- web app manifest
- installable metadata/icons placeholders using existing brand assets where possible
- service worker/offline cache strategy compatible with static export
- cache approved SOP summaries/content intentionally
- cache the staff's already-loaded current shift/task data
- local outbox for permitted operational writes only if it can be done safely and tested
- visible `Offline` / `Pending sync` state
- idempotency key for queued submissions

If robust offline write sync is too large for Phase 1, implement:
1. installability,
2. cached approved SOP viewing,
3. clear offline-read mode,
then document queued-write sync as the next increment.
Do not fake offline write safety.

## QR deep links
Generate/store a stable opaque QR token per equipment asset.
Expected route shape may be something like `/pocket/equipment/?q=<token>` or another static-export-safe route.
Do not expose sensitive sequential IDs if a random token is easy to use.

Phase 1 only needs the deep-link architecture and printable QR data value; polished bulk label/PDF generation can follow later.

## Design requirements
Respect `docs/design.md`.
Kitchen Pocket refinements:
- 44px+ practical touch targets
- no dense spreadsheet-like forms on phone
- clear status hierarchy
- minimal typing
- high contrast
- success is calm, not neon green
- red/brick reserved for real failures/safety/destructive states
- use progressive disclosure for detail
- search must be fast and tolerant of common kitchen terms

## Seed/demo content
Do not seed invented safety procedures as approved.
For developer/demo purposes, it is acceptable to create obviously labelled `DRAFT / DEMO — NOT APPROVED FOR OPERATION` examples.

Real equipment-specific SOPs must wait for exact model/manual confirmation and competent review.

## Tests
Minimum testing expected:
- permission access tests
- SOP version/history integrity
- cannot expose draft SOP to ordinary staff
- temperature within-range path
- temperature outside-range creates/forces corrective action
- shift item completion audit
- QR token lookup
- idempotent duplicate submission handling if offline/outbox added
- existing booking/guest/room/kitchen-cover regression smoke tests

## Documentation
Update:
- `PROGRESS.md`
- OpenAPI contract
- migration notes
- run/deploy docs if PWA assets or service worker change build/deploy behaviour

## First deliverable acceptance criteria
Phase 1 is acceptable when:
1. A kitchen staff user can open Pocket on mobile and access a Kitchen SOP & Operations section.
2. They can view approved SOPs and an equipment quick page.
3. They can execute an Opening or Closing checklist instance.
4. They can submit a configured temperature reading.
5. An out-of-range reading is visibly flagged and linked to corrective action.
6. A manager can create/edit/approve versioned SOP content and manage equipment metadata.
7. Actions are permission-protected and auditable.
8. Existing Vedanta OS routes still build and function.
9. Pocket is installable as a PWA or the exact blocker is documented with a safe next step.

## Do not do in Phase 1
- do not rebuild Parslia recipes/menu intelligence
- do not create a second kitchen ordering system
- do not build hotelkit integration yet; only keep data model integration-ready
- do not build full video production tooling
- do not create AI auto-publishing of safety SOPs
- do not introduce React Native/Expo
- do not redesign the entire Vedanta OS
- do not remove existing routes or migrations
- do not invent manufacturer instructions
