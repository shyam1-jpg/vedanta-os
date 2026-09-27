# Vedanta Retreat Operating System

Working house OS for **The Vedanta Way**. Authoritative architecture: [docs/MASTER_ARCHITECTURE_2026.md](docs/MASTER_ARCHITECTURE_2026.md). Progress: [PROGRESS.md](PROGRESS.md).

The older “NestJS / 45-room seed” description is stale. The stack was **not** rewritten to match that text — the documentation is corrected to match the code.

## What is here

```
apps/web-admin        House UI — Next.js static export (not a live App Router server)
apps/web-guest        Guest book at /book/
apps/web-staff        Pocket at /pocket/
services/platform-api Fastify API on port 4000 (not NestJS)
packages/contracts    OpenAPI 3.1 — keep as the contract; live routes are /v1/*
domains/*             Pure domain logic: state machines, rules, no framework code
db/migrations         PostgreSQL schema, one numbered file per change
db/seed               Property seed. Live inventory is 42 rooms (41 guest + staff room 104)
config/               Property configuration (rooms_total: 42). Rooms 301–307 are not invented
infra/                docker-compose for local Postgres + Redis
docs/                 Architecture, import notes, ADRs
PROGRESS.md           What is done, what is next — read this first every session
```

## Run locally

```
docker compose -f infra/docker-compose.yml up -d
cd services/platform-api && npm install && npm run migrate && npm run dev
# in another terminal:
cd apps/web-admin && npm install && npm run dev
```

Open http://localhost:3000. Production staff sign in with Microsoft 365 and a second factor. On a local machine only, set `ALLOW_DEV_LOGIN=true` and a `DEV_LOGIN_SECRET` of at least 16 characters, then sign in as an `@example.invalid` address. That door stays shut in production and on a hosted database.

The production web bundle uses one origin: `/` redirects guests to `/book/`, house operations remain at `/house/`, and staff use `/pocket/`. Run `npm run build:web-bundle` to create `dist-web/` for static hosting. Kitchen Pro, folio, finance, HR, purchasing, emergency, guest 360, programme tools and sessions stay in this tree.

Card payments stay in the code and stay off until `PAYMENTS_ENABLED=true`. The restaurant is buffet only, so food is not billed. The only till on the roadmap is the reception shop, which is a later phase. Card numbers and security codes are never stored.

## Deploy

This change does not deploy. See [docs/deploy.md](docs/deploy.md) when Shyam is ready. Do not put real guest data back into the repository.

## Rules of the repo

- Only command endpoints change state. Every transition records actor, reason and version.
- Money is `numeric(12,2)` with an ISO currency; never floats.
- Every row carries `tenant_id` and (where relevant) `property_id`.
- Anything that touches allergens, payments, refunds or safety is a release gate, not a feature.
