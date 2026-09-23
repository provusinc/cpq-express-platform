<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Conventions

Vocabulary comes from `CONTEXT.md` (the glossary) and decisions come from `docs/adr/`. Name code, tables, routes and UI copy with the glossary term, and avoid the words it lists under _Avoid_. For example, use Organization (not tenant or org) and Account (not customer). If code and the glossary disagree, that's a bug: fix one of them.

## Packages

Workspace packages are TypeScript source with no build step, imported as `@workspace/<name>`.

- `domain`: pure business rules (pricing, dates, status machine, permission policy). It has no I/O and no framework, and imports no other workspace package; lint enforces this. It is the only package shared by the browser and the server.
- `db`: Drizzle schema, `createDb`, the `db` singleton (`@workspace/db/client`, app only), migrations, the tenancy helpers (`organizationTable`, `organizationReference`, `organizationScope`) and the seed (`@workspace/db/seed`). It also re-exports `drizzle-orm/sql` operators (`sql`, `eq`, …), so other packages import those from `@workspace/db`.
- `api`: tRPC routers and procedure tiers. It depends on `domain`, `db` and `auth`. `@workspace/api/headers` holds the request-header names and has no dependencies, so `proxy.ts` can import it.
- `auth`: Auth.js config and session helpers. `@workspace/auth` is framework-free (`getSessionFromHeaders`, `Session`, `resolveRedirect`) and safe in any server package; `@workspace/auth/next` is the Auth.js instance (`handlers`, `auth()`, `oauthProviders`), app only; `@workspace/auth/react` has client `signIn`/`signOut`; `@workspace/auth/env` is its env schema.
- `documents` (#21) is a placeholder.
- `apps/web`: calls the API only through tRPC: no Server Actions and no direct db access in components. The only route handlers are Auth.js, `/api/trpc`, Quote Document download and `/api/health`.

## UI layout (apps/web)

- Routes live under `app/hosts/<surface>/` (see Hosts and routing). Keep route files thin: a page fetches through tRPC and renders feature components.
- Feature components live in `components/<area>/`, one folder per feature area, named with the glossary term: `auth`, `organizations` (picker, no-access), `shell` (sidebar, Organization switcher, user menu, `PageHeader`, `PlaceholderPage`), and later `quotes`, `accounts`, `catalog`, `resource-roles`, `settings`, `members`. Never one flat folder. Shared primitives come from `@workspace/ui/components/*`; add new ones with the shadcn CLI from `apps/web` (`pnpm dlx shadcn@latest add <name>`), which writes them to `packages/ui`.
- Pure helpers go in `lib/`, with Vitest tests next to them (`lib/*.test.ts`, run by `pnpm test`). `lib/urls.ts` (server only) builds absolute URLs between surfaces: `appUrl()`, `adminUrl()`, `organizationUrl(slug, path)`, `signInUrl(callbackUrl)`, `currentPath()`.
- Organization pages render inside the shell from `app/hosts/org/[slug]/layout.tsx`. Each nav entry in `components/shell/nav.ts` has a page; a new feature replaces its `PlaceholderPage`. Admin-only pages check `membership.role` again on the server (see `settings/page.tsx`); hiding the nav entry is not a check.

## Hosts and routing

One app serves every subdomain. `apps/web/proxy.ts` resolves the Host header (`lib/hosts.ts`, pure, never the DB) and rewrites to that surface's route tree under `app/hosts/`:

- `app.<ROOT_DOMAIN>/x` → `app/hosts/app/x` (sign-in, check-email, the Organization picker at `/`).
- `admin.<ROOT_DOMAIN>/x` → `app/hosts/admin/x` (Platform Admin console; a placeholder until #5).
- `{slug}.<ROOT_DOMAIN>/x` → `app/hosts/org/[slug]/x` (an Organization).
- Reserved subdomains (`app`, `admin`, `www`, `api`, `auth`, `docs`, `status`) are never Organizations; the reserved ones without a surface, nested subdomains and labels that can't be a slug get a 404, API included. Whether the Organization exists is decided by the server layer, never the proxy.
- `/api/*` is shared by every host and never rewritten. Direct requests to `/hosts/*` get a 404. Other hosts (bare root domain, `localhost`) pass through untouched.
- The proxy stamps every request (pages and `/api/*`) with `x-organization-slug` from the Host header, replacing any client-sent value, and with `x-request-path` (the public path + query). So the tRPC route handler and the RSC caller (`getCaller()`) both know the request's Organization without the client sending anything.

Links and `redirect()` inside a surface use the public path (`/sign-in`), not `/hosts/app/sign-in`.

## Authentication

- Auth.js v5 with the Drizzle adapter and database sessions. The providers are email magic link over SMTP (Mailpit locally, at http://localhost:8025), plus Google and Microsoft Entra ID, each only when its `AUTH_*` credentials are set. There is no credentials provider.
- The session cookie (`authjs.session-token`, or `__Secure-…` on https) is scoped to `.<ROOT_DOMAIN>`, so every subdomain sees it. Sign-in and sign-out happen on `app.`, and sign-out deletes the DB session. Auth.js builds its URLs from `APP_URL`, and redirects are allowed only to `<ROOT_DOMAIN>` and its subdomains (`resolveRedirect`).
- To send someone to sign in from another subdomain, redirect them to `signInUrl(<absolute url>)` from `@/lib/urls`, i.e. `${APP_URL}/sign-in?callbackUrl=…`. The Organization layout does this with the current URL.
- Server code reads the session via tRPC: `ctx.session` in procedures, or `(await getCaller()).auth.getSession()` in server components. Client components call `signIn`/`signOut` from `@workspace/auth/react`, never Server Actions.
- The global identity tables (`users`, `accounts`, `sessions`, `verification_tokens`) are in `packages/db/src/schema/auth.ts` and have no `organization_id`. `users.is_platform_admin` marks a Platform Admin.

## Tenancy (ADR-0001)

- `organizations` (slug, name, `currency_code`) is the tenancy root. Slugs are DNS labels, unique, never reserved (check constraints) and immutable (a trigger rejects changes). `memberships` holds `(organization_id, user_id)` unique, `role` (`admin` | `manager` | `member`, pg enum `membership_role`) and `is_approver`. Platform Admin is `users.is_platform_admin`, and it grants no Organization access: support staff need a normal Membership.
- **Every business table** is declared with `organizationTable(name, columns, extra?)` from `@workspace/db` instead of `pgTable`. It adds `id` (UUIDv7), `organization_id` (→ organizations) and the unique `(organization_id, id)` key.
- **Every reference between business tables** is a composite FK via `organizationReference(t, t.xId, xTable)` in the extra config: `(organization_id, x_id) → x(organization_id, id)`. Keep `xId: uuid()` without `.references()`. Chain `.onDelete(...)` as needed, but never `set null` (it would null `organization_id`); nullable references just work. References to global tables (users) stay plain `.references()`. The full recipe and an example are in `packages/db/src/organization-table.ts`.
- **Access business rows only through the Organization scope.** In procedures that is `ctx.scope` (an `OrganizationScope`): `findById`, `findMany({ where, orderBy, limit })`, `insert`, `insertMany`, `update(table, id, changes)`, `delete(table, id)` and `transaction(fn)`. Every call is filtered by (or stamped with) the Organization, and `update` ignores `organizationId`/`id`. For joins, use `ctx.scope.db` and put `ctx.scope.where(table, …conditions)` on every business table in the query (see `routers/membership.ts`). A missing row comes back `undefined`; turn it into `NOT_FOUND`.
- Enum literals (`ROLES`) live in `@workspace/db` for now and will be reconciled with `@workspace/domain`. So will the reserved slug list, which today lives in both `packages/db/src/schema/organizations.ts` and `apps/web/lib/hosts.ts`, with a test that keeps them equal.

## Environment

There is one root `.env`, templated by `.env.example`. Add every new variable in three places: `.env.example` (with a comment), the zod schema (`apps/web/env.ts`, or the owning package's `env.ts`), and `globalEnv` in `turbo.json`. In the app, read values with `env.X` from `@/env`. A package script that needs env runs through `pnpm with-env <cmd>`.

## Database and migrations

- Put schema files in `packages/db/src/schema/<area>.ts` and re-export each one from `schema/index.ts`. Use `id()` and `timestamps()` from `src/columns.ts`. Primary keys are UUIDv7, generated in the app because Postgres 17 has no `uuidv7()`.
- Write columns in camelCase in TS. `casing: "snake_case"` maps them to snake_case in SQL, so don't pass column names.
- Every business table has `organization_id`, and foreign keys between business tables are composite `(organization_id, id)` (ADR-0001).
- `pnpm db:seed` upserts demo data into `DATABASE_URL`: a Platform Admin (`platform@provus.local`), `acme` (USD) with `admin@`, `manager@`, `member@` and `approver@acme.test` (a Member who is an Approver), and `globex` with `admin@globex.test`. It is idempotent: every row is upserted by a natural key (email, slug, (Organization, User)), so it's safe to re-run and resets seeded rows only. For a clean slate, run `docker compose down -v`, then `pnpm services:up && pnpm db:migrate && pnpm db:seed`. Later areas add an idempotent `seed<Area>(tx, organizations)` step in `packages/db/src/seed/index.ts`.
- To change the schema: edit it, run `pnpm db:generate --name=<what>`, review and commit the SQL in `packages/db/migrations/`, then run `pnpm db:migrate`. API tests migrate the test database themselves, and `pnpm db:migrate:test` does it by hand. Never edit a migration that has already been committed; add a new one. `db:push` is for throwaway experiments only.
- Server code takes the `Db` type, which accepts the root client or a transaction. Calling `db.transaction()` inside a transaction creates a savepoint.

## Money (ADR-0002)

- Store money as `numeric(19,4)`, percentages as `numeric(7,4)` and quantities as `numeric(18,3)`. Postgres returns these as strings; wrap them with `Decimal` from `@workspace/domain`.
- Do all arithmetic with `Decimal`, never JS `number`. Keep values as strings at the API boundary.
- The server recomputes totals through the domain pricing engine and ignores totals sent by the client.

## tRPC

- Add a router in `packages/api/src/routers/<area>.ts` and register it under its area name in `src/root.ts`.
- Build each procedure on the narrowest tier in `src/trpc.ts`, which documents the tiers:
  - `publicProcedure`: anyone.
  - `authedProcedure`: gives non-null `ctx.session` and `ctx.user`, and throws UNAUTHORIZED otherwise.
  - `organizationProcedure`: authed, plus a Membership in the request's Organization (from `x-organization-slug`). It adds `ctx.organization` (`id`, `slug`, `name`, `currencyCode`), `ctx.membership` (`id`, `role`, `isApprover`) and `ctx.scope`. All business data goes through this tier's `ctx.scope`.
  - `adminProcedure`: organization tier with Role = Admin.
  - `platformProcedure`: authed Platform Admin, with no Organization.
- Refusals are uniform, so they never reveal what exists: no session → UNAUTHORIZED; no slug header (e.g. called from `app.`) → BAD_REQUEST; an unknown Organization **or** no Membership → NOT_FOUND (identical); another Organization's record id → NOT_FOUND; a Member without the needed Role or Approver right, or a non–Platform Admin → FORBIDDEN.
- `organization.current` returns the request's Organization and Membership. `organization.listMine` (authed) lists the caller's Memberships for the picker and switcher. `membership.list` and `membership.byId` are the first scoped reads.
- Mutations are intention-revealing commands, one per user gesture, and each runs in one transaction (ADR-0003). Validate input with zod.
- Server components on an Organization subdomain call Organization-tier procedures through `getCaller()`/`prefetch` directly; the proxy has already set the slug header. Client components on the subdomain call same-origin, so the same applies. Client-component queries are not fetched with the session during SSR, so prefetch in the RSC anything needed on first paint.
- In `apps/web`, client components use `useTRPC()` from `@/trpc/react` with `useQuery`, `useSuspenseQuery` or `useMutation` and `trpc.<area>.<proc>.queryOptions()` or `.mutationOptions()`. Server components call `prefetch(trpc.….queryOptions())` from `@/trpc/server` and wrap the client subtree in `<HydrateClient>`. `getCaller()` gives direct server-side calls.

## Tests

- Test external behaviour through public interfaces. Use no DB mocks, and don't assert on internal calls or query shapes.
- API tests are the primary seam. Put them next to the router (`src/routers/<area>.test.ts`) and call through the harness in `packages/api/src/test`, which runs against the real test database, rolls back every test, and makes nested transactions savepoints:
  ```ts
  it("…", () => withTestDb(async (db) => {
    const caller = createTestCaller(db)
    expect(await caller.health.check()).toMatchObject({ status: "ok" })
  }))
  ```
  Signed-in callers use `createTestCaller(db, { user: await createUser(db) })`, which injects the session. To exercise the real cookie lookup instead, use `createSession(db, user)` and pass its `cookie` in `headers`. Fixtures live in `src/test/fixtures.ts` and are re-exported from `../test`. Add shared fixtures there rather than writing setup in each test.
- Organization-tier tests: `createOrganization(db, overrides?)`, `createMembership(db, { organization, user, role?, isApprover? })`, or `createMember(db, organization, { role?, isApprover?, user? })`, which returns `{ user, membership }`. Then call as that user on that Organization's subdomain with `organizationCaller(db, { organization, user })`.
- **Tenancy isolation gate (required).** Every organization-tier procedure that takes a record id gets an isolation test. `expectIsolated` creates an outsider Organization whose Admin is also an Approver, and calls the procedure both on the outsider's own subdomain and on the owner's subdomain. It expects NOT_FOUND or FORBIDDEN each time, and checks that `snapshot` reads the same before and after. Each attempt runs in a rolled-back savepoint.
  ```ts
  it("is isolated from other Organizations", () => withTestDb(async (db) => {
    const acme = await createOrganization(db)
    const account = await organizationScope(db, acme.id).insert(accounts, { name: "Initech" })
    await expectIsolated(db, {
      owner: acme,
      call: (caller) => caller.account.rename({ id: account.id, name: "Hacked" }),
      snapshot: () => db.select().from(accounts).where(eq(accounts.id, account.id)),
    })
  }))
  ```
  Procedures without a record id (like `organization.current`) instead test that a non-member is refused on the owner's subdomain.
- Domain tests are table-driven Vitest in `packages/domain/src/**/*.test.ts`.

## Before committing

Run `pnpm typecheck`, `pnpm lint` and `pnpm test`. All three must pass: lint allows zero warnings, and the API tests need `pnpm services:up`.
