<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Conventions

Vocabulary comes from `CONTEXT.md` (the glossary) and decisions come from `docs/adr/`. Name code, tables, routes and UI copy with the glossary term, and avoid the words it lists under _Avoid_. For example, use Organization (not tenant or org) and Account (not customer). If code and the glossary disagree, that's a bug: fix one of them.

## Packages

Workspace packages are TypeScript source with no build step, imported as `@workspace/<name>`.

- `domain`: pure business rules (pricing, dates, status machine, permission policy). It has no I/O and no framework, and imports no other workspace package; lint enforces this. It is the only package shared by the browser and the server.
- `db`: Drizzle schema, `createDb`, the `db` singleton (`@workspace/db/client`, app only), migrations. It also re-exports `drizzle-orm/sql` operators (`sql`, `eq`, …), so other packages import those from `@workspace/db`.
- `api`: tRPC routers and procedure tiers. It depends on `domain`, `db` and `auth`.
- `auth`: Auth.js config and session helpers. `@workspace/auth` is framework-free (`getSessionFromHeaders`, `Session`, `resolveRedirect`) and safe in any server package; `@workspace/auth/next` is the Auth.js instance (`handlers`, `auth()`, `oauthProviders`), app only; `@workspace/auth/react` has client `signIn`/`signOut`; `@workspace/auth/env` is its env schema.
- `documents` (#21) is a placeholder.
- `apps/web`: UI organised by feature area (`components/<area>/`). It calls the API only through tRPC: no Server Actions and no direct db access in components. The only route handlers are Auth.js, `/api/trpc`, Quote Document download and `/api/health`.

## Hosts and routing

One app serves every subdomain. `apps/web/proxy.ts` resolves the Host header (`lib/hosts.ts`, pure, never the DB) and rewrites to that surface's route tree under `app/hosts/`:

- `app.<ROOT_DOMAIN>/x` → `app/hosts/app/x` (sign-in, check-email, home).
- #4 adds `admin.` → `app/hosts/admin/` and `{slug}.` → `app/hosts/org/[slug]/` by extending `HostSurface` and `internalPath` in `lib/hosts.ts`.
- `/api/*` is shared by every host and never rewritten. Direct requests to `/hosts/*` get a 404. Other hosts (bare root domain, `localhost`) pass through untouched.

Links and `redirect()` inside a surface use the public path (`/sign-in`), not `/hosts/app/sign-in`.

## Authentication

- Auth.js v5 with the Drizzle adapter and database sessions. The providers are email magic link over SMTP (Mailpit locally, at http://localhost:8025), plus Google and Microsoft Entra ID, each only when its `AUTH_*` credentials are set. There is no credentials provider.
- The session cookie (`authjs.session-token`, or `__Secure-…` on https) is scoped to `.<ROOT_DOMAIN>`, so every subdomain sees it. Sign-in and sign-out happen on `app.`, and sign-out deletes the DB session. Auth.js builds its URLs from `APP_URL`, and redirects are allowed only to `<ROOT_DOMAIN>` and its subdomains (`resolveRedirect`).
- To send someone to sign in from another subdomain, redirect them to `${APP_URL}/sign-in?callbackUrl=<absolute url>`.
- Server code reads the session via tRPC: `ctx.session` in procedures, or `(await getCaller()).auth.getSession()` in server components. Client components call `signIn`/`signOut` from `@workspace/auth/react`, never Server Actions.
- The global identity tables (`users`, `accounts`, `sessions`, `verification_tokens`) are in `packages/db/src/schema/auth.ts` and have no `organization_id`. `users.is_platform_admin` marks a Platform Admin.

## Environment

There is one root `.env`, templated by `.env.example`. Add every new variable in three places: `.env.example` (with a comment), the zod schema (`apps/web/env.ts`, or the owning package's `env.ts`), and `globalEnv` in `turbo.json`. In the app, read values with `env.X` from `@/env`. A package script that needs env runs through `pnpm with-env <cmd>`.

## Database and migrations

- Put schema files in `packages/db/src/schema/<area>.ts` and re-export each one from `schema/index.ts`. Use `id()` and `timestamps()` from `src/columns.ts`. Primary keys are UUIDv7, generated in the app because Postgres 17 has no `uuidv7()`.
- Write columns in camelCase in TS. `casing: "snake_case"` maps them to snake_case in SQL, so don't pass column names.
- Every business table has `organization_id`, and foreign keys between business tables are composite `(organization_id, id)` (ADR-0001).
- To change the schema: edit it, run `pnpm db:generate --name=<what>`, review and commit the SQL in `packages/db/migrations/`, then run `pnpm db:migrate`. API tests migrate the test database themselves, and `pnpm db:migrate:test` does it by hand. Never edit a migration that has already been committed; add a new one. `db:push` is for throwaway experiments only.
- Server code takes the `Db` type, which accepts the root client or a transaction. Calling `db.transaction()` inside a transaction creates a savepoint.

## Money (ADR-0002)

- Store money as `numeric(19,4)`, percentages as `numeric(7,4)` and quantities as `numeric(18,3)`. Postgres returns these as strings; wrap them with `Decimal` from `@workspace/domain`.
- Do all arithmetic with `Decimal`, never JS `number`. Keep values as strings at the API boundary.
- The server recomputes totals through the domain pricing engine and ignores totals sent by the client.

## tRPC

- Add a router in `packages/api/src/routers/<area>.ts` and register it under its area name in `src/root.ts`.
- Build each procedure on the narrowest tier in `src/trpc.ts`, which documents the tiers. `authedProcedure` gives non-null `ctx.session` and `ctx.user`, and throws UNAUTHORIZED otherwise. Business data always goes through the organization tier's scoped access (from #4).
- Mutations are intention-revealing commands, one per user gesture, and each runs in one transaction (ADR-0003). Validate input with zod.
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
  Signed-in callers use `createTestCaller(db, { user: await createUser(db) })`, which injects the session. To exercise the real cookie lookup instead, use `createSession(db, user)` and pass its `cookie` in `headers`. Fixtures live in `src/test/fixtures.ts` and are re-exported from `../test`. Add shared fixtures there (Organizations and Memberships come in #4) rather than writing setup in each test.
- Domain tests are table-driven Vitest in `packages/domain/src/**/*.test.ts`.

## Before committing

Run `pnpm typecheck`, `pnpm lint` and `pnpm test`. All three must pass: lint allows zero warnings, and the API tests need `pnpm services:up`.
