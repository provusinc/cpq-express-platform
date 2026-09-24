# CPQ Express Platform

Standalone, multi-tenant CPQ Express. Each **Organization** gets its own
subdomain (`{slug}.<ROOT_DOMAIN>`). This is a Turborepo + pnpm monorepo: a
Next.js 16 app, a tRPC API, Drizzle on Postgres, and pure domain logic.

- Domain glossary: [`CONTEXT.md`](./CONTEXT.md)
- Architecture decisions: [`docs/adr/`](./docs/adr)
- Conventions for contributors and agents: [`AGENTS.md`](./AGENTS.md)

## Layout

```
apps/web              Next.js app (every subdomain), tRPC endpoint, RSC prefetch
packages/api          tRPC routers and procedure tiers, plus the API test harness
packages/db           Drizzle schema, client, migrations (committed SQL)
packages/domain       Pure business rules (pricing, dates, status, permissions)
packages/auth         Auth.js config and session helpers
packages/documents    Quote Document PDF components (react-pdf), browser preview + server render
packages/storage      S3-compatible object storage (MinIO locally) for logos and Quote Documents
packages/ui           shadcn/ui components (base-nova, Base UI)
packages/eslint-config, packages/typescript-config   shared configs
```

## Local setup

Prerequisites: **Node 22.12+** (see `.nvmrc`), **pnpm 10** (`corepack enable`),
and **Docker** (Docker Desktop or similar).

```sh
pnpm install
cp .env.example .env          # then set AUTH_SECRET: openssl rand -base64 32
pnpm services:up              # docker compose up -d: Postgres, MinIO, Mailpit
pnpm db:migrate               # apply migrations to the dev database (cpq)
pnpm db:seed                  # demo Organizations and Users (idempotent)
pnpm dev                      # http://localhost:3000
```

### Signing in (no passwords)

There are no usernames or passwords: sign-in is by emailed magic link (plus
Google / Microsoft when their credentials are set in `.env`). Locally every
email is caught by Mailpit, so nothing leaves your machine.

1. Open http://app.localtest.me:3000 and enter a seeded email (below).
2. Open Mailpit at http://localhost:8025 and click the newest
   "Sign in to app.localtest.me:3000" message.
3. Follow the link; you land signed in on the Organization's subdomain.

Links are single-use and expire, so always use the newest message. One sign-in
works across every `*.localtest.me` subdomain. Start with `admin@acme.test` to
see everything in `acme`.

| Email                   | Who                                                        |
| ----------------------- | ---------------------------------------------------------- |
| `admin@acme.test`       | `acme` Admin: settings, catalog, members, edits any Quote  |
| `manager@acme.test`     | `acme` Manager: own Quotes and Members' Quotes              |
| `member@acme.test`      | `acme` Member: own Quotes only                             |
| `approver@acme.test`    | `acme` Member with the Approver right                      |
| `admin@globex.test`     | `globex` Admin (a second Organization, for isolation)      |
| `platform@provus.local` | Platform Admin: console at http://admin.localtest.me:3000   |

Organizations live at http://acme.localtest.me:3000 and
http://globex.localtest.me:3000.

Check it's working: the home page shows the API and database status, and so
does `curl http://localhost:3000/api/health`.

### Tests

```sh
pnpm test                     # domain unit tests + API tests on the test database
```

API tests run against the real `cpq_test` database. Migrations are applied to
it automatically before each run, and every test runs in a transaction that is
rolled back. The services must be up. `pnpm db:migrate:test` migrates the test
database by hand.

### Everyday scripts (run from the repo root)

| Script                    | What it does                                            |
| ------------------------- | ------------------------------------------------------- |
| `pnpm dev`                | Run the app in dev mode                                 |
| `pnpm build`              | Production build                                        |
| `pnpm typecheck`          | `tsc --noEmit` in every package                         |
| `pnpm lint`               | ESLint in every package (zero warnings allowed)         |
| `pnpm test`               | Vitest in `domain`, `auth`, `api` and `web`             |
| `pnpm db:generate`        | Generate a SQL migration from schema changes            |
| `pnpm db:migrate`         | Apply migrations to `DATABASE_URL`                      |
| `pnpm db:migrate:test`    | Apply migrations to `TEST_DATABASE_URL`                 |
| `pnpm db:seed`            | Upsert demo data into `DATABASE_URL` (safe to re-run)   |
| `pnpm db:push`            | Push the schema without a migration (experiments only)  |
| `pnpm db:studio`          | Drizzle Studio                                          |
| `pnpm services:up/down`   | Start or stop the Docker services                       |

## Local services

| Service       | URL / port                                                   | Credentials                       |
| ------------- | ------------------------------------------------------------ | --------------------------------- |
| Postgres 17   | `localhost:5432`, databases `cpq` and `cpq_test`              | `cpq` / `cpq`                     |
| MinIO (S3)    | API `http://localhost:9000`, console `http://localhost:9001`  | `cpq-minio` / `cpq-minio-secret`  |
| Mailpit       | SMTP `localhost:1025`, UI `http://localhost:8025`             | none                              |

The `minio-init` container creates the `cpq-documents` bucket and then exits.
`cpq_test` is created by `docker/postgres/init-test-db.sql` the first time the
Postgres volume is initialised. If you created the volume before that script
existed, run `docker compose down -v` to recreate it.

**Port clashes:** if another program already uses one of these ports, set
`POSTGRES_PORT`, `MINIO_PORT`, `MINIO_CONSOLE_PORT`, `MAILPIT_SMTP_PORT` or
`MAILPIT_UI_PORT` in `.env`. Compose reads the root `.env` automatically. Then
update the matching URLs (`DATABASE_URL`, `S3_ENDPOINT`, …) to the new ports.

## Subdomains locally: `*.localtest.me`

`localtest.me` and **every subdomain of it** resolve to `127.0.0.1` in public
DNS, so you don't need to edit `/etc/hosts`. With `ROOT_DOMAIN=localtest.me`:

- `http://app.localtest.me:3000`: sign-in, Organization picker, Invitations
- `http://admin.localtest.me:3000`: Platform Admin console
- `http://acme.localtest.me:3000`: the `acme` Organization

These subdomains only resolve if your network's DNS resolver doesn't block
them. `next.config.ts` allows `*.<ROOT_DOMAIN>` as a dev origin.

## Environment

The single root `.env` is the only env file. `.env.example` documents every
variable. Package scripts load it with `dotenv -e ../../.env --` (the
`with-env` script in each package). The web app validates it at startup with
`@t3-oss/env-nextjs` (`apps/web/env.ts`), and the db package does the same with
`@t3-oss/env-core` (`packages/db/src/env.ts`). Set `SKIP_ENV_VALIDATION=1` to
skip validation, for example for a CI lint without services.

## Troubleshooting

- **Nothing on port 3000:** run `pnpm dev` (and `pnpm services:up` first if
  Docker was restarted). `curl http://localhost:3000/api/health` should report
  the database as connected.
- **No sign-in email:** check Mailpit (http://localhost:8025) is up
  (`docker compose ps`). The email is only sent for the address you typed.
- **"No access" on an Organization subdomain:** the signed-in User has no
  Membership there. Sign out on `app.` and sign in as a User of that
  Organization, or pick another from the Organization picker.
- **`*.localtest.me` doesn't resolve:** some DNS resolvers or VPNs block it.
  Switch DNS (e.g. 1.1.1.1) or add the subdomains you need to `/etc/hosts`.
- **Migration errors after pulling:** run `pnpm db:migrate && pnpm db:migrate:test`.
  If a local database has drifted, point `DATABASE_URL` / `TEST_DATABASE_URL`
  in `.env` at fresh databases (create them with
  `docker compose exec postgres psql -U cpq -c "create database <name>"`),
  then migrate and `pnpm db:seed`.
- **Demo data looks odd:** `pnpm db:seed` restores the demo Quotes (it's safe to
  re-run; it doesn't remove Quotes you created).
