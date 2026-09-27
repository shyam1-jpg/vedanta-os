# Running the platform locally

Needs: Docker (for Postgres) or a local PostgreSQL 16, Node 22+, Python 3 with openpyxl (for the importer).

```
# 1. Database
docker compose -f infra/docker-compose.yml up -d
npm run db:migrate                # migrations, property seed, dev users

# 2. Import the bookings sheet (optional, re-runnable)
python3 tools/import-sheet/import_calendar.py "The Vedanta Calendar.xlsx" out
python3 tools/import-sheet/load_groups.py out/groups.json out/groups.sql
docker exec -i vedanta-db psql -U vedanta -d vedanta < out/groups.sql
python3 tools/import-sheet/import_roomsheet.py "The Vedanta Calendar.xlsx" out/rooms.sql 2025 2026
docker exec -i vedanta-db psql -U vedanta -d vedanta < out/rooms.sql
#    Do not load a booking-sheet dump from git. The old import file held real guest details
#    and has been removed from the working tree. Use synthetic seed 0022 for a local demo.

# 3. API  (port 4000)
cd services/platform-api && npm install && npm run dev

# 4. Admin app  (port 3000)
cd apps/web-admin && npm install && npm run dev
```

Open http://localhost:3000.

Staff sign in with Microsoft 365. For local development only, set `ALLOW_DEV_LOGIN=true` and `DEV_LOGIN_SECRET` (16 characters or more), then use an `@example.invalid` address. The development door refuses production and a hosted database. There is no email-only staff sign-in and the X-User header is never a credential.
