# Feature audit — 28 September 2026

Checked on a local demo database with the synthetic seed, signed in through the development door (`POST /auth/dev-login`, `@example.invalid` only). House admin, the guest book (`/book`) and the pocket (`/pocket`) were walked against the API. Status is one of: works, fixed, broken-not-fixed, not built.

| Area | Feature | Status | Notes |
| --- | --- | --- | --- |
| House admin | Today | works | House ledger, payments due and the enquiry count open. The morning briefing stays quiet until an AI key is set. |
| House admin | Bookings | works | Group list, guest enquiries and private stays load. A synthetic enquiry saved. Food is not billed. |
| House admin | Room board | works | Rooms and occupancy load. Place, move and link commands are on the API. |
| House admin | House log | works | Board, handover, notices, checklist ticks and guest requests load. |
| House admin | Tasks | fixed | List, create, status, comment and attachment work. An SOP slug on a task is now a link to the SOP page. |
| House admin | Front desk | works | Front-desk board and food-and-drink orders load. Orders can be marked done. |
| House admin | Night porter | works | Night board, estate pulse, checklist and night handover load. |
| House admin | Department boards | fixed | Notes and photos save. Each board now lists that department's SOPs. |
| House admin | Manual | works | Chapters list, edit, send and withdraw. |
| House admin | SOPs | fixed | Was only a send box inside Staff corner. There is now a nav item: list by department, open, create, edit, delete, and assign to a person or a department. `sop.read` can read; `sop.manage` can change. |
| House admin | Housekeeping | works | Room statuses and arrival, departure and stayover groups load for a date. |
| House admin | Maintenance | works | Open and closed tickets, assignees, start and done commands load. |
| House admin | Kitchen | works | Covers and in-house dietary flags load from `/v1/covers`. The kitchen is vegetarian, with no eggs and no onion family. Covers are a count, not a bill. |
| House admin | AI Duty Manager | fixed | Without `ANTHROPIC_API_KEY` the page now gets a proper "not configured" answer. The house-context query was failing because it asked for a contact name column that does not exist. Questions themselves still need the key. |
| House admin | Programme sheet | works | Programme list and department work load. Items can be added and the sheet can be regenerated. |
| House admin | Finance dashboard | fixed | The monthly summary crashed because the database date came back as a date object. It now opens, including the KPI strip. |
| House admin | Guests | works | Search, add and dietary record save. Diet save uses PUT, which the browser was not allowed to send. |
| House admin | Guest 360 | works | Profile, stays, communications and complaints load for a guest. |
| House admin | HR & Rota | fixed | Clock in and clock out failed when the button sent an empty JSON body. That is fixed. A shift can be added by hand. Gaps are listed. Approving or declining a holiday refreshes the list. Someone else's training record is no longer readable. |
| House admin | Auto rota | works | New. Guest numbers for a day or a week build a rota for every staffed department. Kitchen 16–35 follows the pilot. Other departments are labelled PLACEHOLDER. Gaps stay visible. Draft save, CSV and print work. |
| House admin | Labour forecast | fixed | The week now starts on Monday even when today is Sunday, and dates stay on the local calendar. A guest still counts on their departure day. This screen is guidance. It does not build the rota. |
| House admin | Staff corner | works | People, organogram, leave, duty, hours, tip split, contracts and the old "send an SOP" box. The SOP tab now points at the SOP library. |
| House admin | Payroll | works | Payroll for a department loads. Clock records can be added. |
| House admin | Names & positions | works | Add a person with department, sub-section and role. Rename a sub-section. Gyms is a sub-section of Restaurant, and the name can be changed. |
| House admin | My devices | fixed | The page crashed because a session had no id. Signing out a device now sticks: a revoked session can no longer call the API. Sign-in history is written. |
| House admin | Imported bookings | works | The review queue loads. |
| House admin | Data quality | works | Findings load and a finding can be updated. |
| House admin | Reports | works | The monthly report loads. |
| House admin | Purchasing | works | Suppliers, requisitions, purchase orders and invoices load. A requisition can be approved. |
| House admin | Emergency & compliance | works | Incidents, assets and compliance items load. An incident can take an action and be resolved. |
| House admin | Settings | works | Packages and integration keys load for someone with package management. Staffing levels are edited on Auto rota, which the head chef can open. |
| House admin | Sign out | fixed | Sign-out sent an empty body and was rejected before the session was cleared. |
| Guest book | Property, programmes, rooms | works | Public pages load with no sign-in. |
| Guest book | Availability | works | Arrival, departure and party size return rooms. |
| Guest book | Open My Stay / sign in / access code | works | Development can open a stay. Production refuses a new stay until email verification is switched on. |
| Guest book | Enquiry | works | A vegetarian enquiry with an `@example.invalid` address saved. |
| Guest book | Deposit / card payment | not built | Stripe stays off until `PAYMENTS_ENABLED` is set. The enquiry path does not take a card. |
| Guest book | Requests during a stay | works | A signed-in guest can send a request. |
| Pocket | Clock | works | Clock in and out on the staff audience. |
| Pocket | Holiday | works | Leave list and a new request. |
| Pocket | Duty | works | The duty list loads. |
| Pocket | House log, tasks, front desk, night, manual | works | The same boards as the house admin, on the staff audience. |
| Pocket | SOP | works | Assigned procedures list, and "mark as read" no longer fails on an empty body. |
| Pocket | My rota | not built | The generated rota is in the house admin. The pocket does not show it yet. |
| Auto rota | Arrival day, departure day and free-day patterns | not built | The generator uses the guest-count bands. It does not yet shorten a shift because it is an arrival or a departure, and it does not add a free-day deep clean. |
| Auto rota | Purchasing, finance, management, sales | not built | Those departments have no staffing bands until someone adds them in Staffing settings. |
| Kitchen | Kiteline published rota | not built | The outside rota sheet is unchanged. This rota is the house draft. |
| Sign-in | Microsoft | not built | Not exercised here. Production sign-in is still Microsoft. The development door stays closed on a hosted database. |
