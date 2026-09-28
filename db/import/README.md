# Booking history

Do not commit guest or client spreadsheets, database dumps, or import SQL into this repository.

The old file `imported_from_sheet_2026-09-02.sql` held real names, email addresses and phone numbers from the booking sheet. It has been removed from the working tree. It is still in the git history of `main` until Shyam decides to rewrite that history.

`db/seed/0022_synthetic_bookings.sql` is the only booking data the project loads by itself. It is made up.

To load the real history into the production database, do it once, by hand, on that database. Do not add the file back to git. `db/import/*.sql` is gitignored so a local copy is not committed by accident.

## Staff names

`staff-teams.example.json` is a placeholder team (example.invalid addresses only). Copy it to `staff-teams.local.json`, replace the emails with each person's Microsoft 365 address, and run:

```
node tools/import-staff/import-teams.mjs
```

`staff-teams.local.json` is gitignored. Do not commit real names, emails or phone numbers. The Names & positions screen can also create each person with a department, a sub-section and a role.
