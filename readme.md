# Kazi Express — Inventory & Operations API

Express + TypeScript API backing the Kazi Express inventory system. It owns the data and
every business rule; the Next.js dashboard in `kaziExpress_frontend` is a client of it.

Data lives in PostgreSQL (Neon) behind Prisma — 29 models covering products and their bills
of materials, inventory batches and stock movements, production tasks, finished-goods sales,
employees, attendance, payroll, permissions and reporting.

## Getting Started

```bash
npm install
npx prisma generate
npx prisma migrate deploy     # or `migrate dev` on a fresh local database
npm run seed                  # optional demo data
npm run dev
```

Runs on `http://localhost:5000`; the API base is `http://localhost:5000/api/v1`.

Copy `.env.example` to `.env` and fill it in. Every variable is validated at boot by
`src/config/config.ts`, which refuses to start on an invalid or incomplete configuration
rather than failing later at the first request that needs it.

The variables that most often need attention on a hosted deployment:

| Variable | Why it matters |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET`, `REFRESH_TOKEN_SECRET` | Token signing. **Do not use the placeholder values from `.env.example`.** |
| `NODE_ENV` | Set to `production` when deployed — this enables the request rate limiter |
| `TRUST_PROXY` | Hop count of reverse proxies in front of the server. `1` on a platform like Render; without it the limiter counts every user as one caller |
| `STORAGE_PROVIDER` | `local` for development, `cloudinary` anywhere hosted — a container filesystem is wiped on every deploy |

## Architecture

```
src/
  app.ts          # Express setup; routes are auto-discovered from modules/**/*.route.ts
  config/         # Environment schema and validated config
  modules/        # One folder per domain, each with route / controller / service / validation
  middlewares/    # Authentication, role and permission guards
  helpers/        # Shared response envelope and validation helpers
  handlers/       # Zod error handling and common validators
  utils/          # Prisma client, storage, sockets, email, scheduler, errors
prisma/           # Schema, migrations and seed
scripts/          # One-off maintenance and generation scripts
tests/            # Standalone integration suites, run against a real database
```

**Routes are discovered by convention.** Any `*.route.ts` under `src/modules` is mounted
automatically at `/api/v1/<folder>` — there is no central route registry to update.

**Every response uses one envelope**, built by `helpers/responses/custom-response.ts`, so
clients can rely on a single success and error shape.

**Authorisation is enforced server-side** by `requirePermission()` and `checkRoles()`. The
dashboard's permission checks are a UX convenience only; this API is authoritative.

**Writes announce themselves.** A Prisma query extension emits the changed model name over
Socket.IO after the transaction commits, and the dashboard invalidates the matching queries.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the API with ts-node |
| `npm run build` / `npm start` | Compile to `dist/` and run the compiled server |
| `npm test` | Run every suite in `tests/` in sequence, stopping at the first failure |
| `npm run test:phase tests/phase16.test.ts` | Run a single suite |
| `npm run seed` | Seed demo data |
| `npm run lint` / `npm run prettier` | Static checks |
| `npm run docs:generate` | Regenerate `src/docs/openapi.json` from the route files |
| `npm run backfill:batch-costs` | Recompute historical batch costs (dry by default, `--write` applies) |
| `npm run repair:media-urls` | Report and repair media rows written under the old absolute-URL scheme, and list documents whose stored file is missing (dry by default, `--write` applies) |
| `npm run resource <name>` | Scaffold a new module |

## Tests

The suites in `tests/` are standalone ts-node programs, not a test-runner harness. They run
against a **real database** using the connection in `.env`, creating and cleaning up their own
fixtures — so point them at a development database, never production.

```bash
npm test                                    # everything
npm run test:phase tests/phase16.test.ts    # one suite
```

## Resource generator

`npm run resource <name>` scaffolds a module under `src/modules/<name>/` with matching
`.route.ts`, `.controller.ts`, `.service.ts`, `.validation.ts` and `.interface.ts` files,
following the conventions above so a new module is mounted without further wiring.

## API documentation

`src/docs/openapi.json` is generated from the route definitions by `npm run docs:generate`.
It is committed so it can be consumed by external tooling; regenerate it after changing routes.
