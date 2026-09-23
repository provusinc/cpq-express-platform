<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Conventions

Vocabulary comes from `CONTEXT.md` (the glossary) and decisions come from `docs/adr/`. Name code, tables, routes and UI copy with the glossary term, and avoid the words it lists under _Avoid_. For example, use Organization (not tenant or org) and Account (not customer). If code and the glossary disagree, that's a bug: fix one of them.

## Packages

Workspace packages are TypeScript source with no build step, imported as `@workspace/<name>`.

- `domain`: pure business rules (pricing, dates, status machine, permission policy). It has no I/O and no framework, and imports no other workspace package; lint enforces this. It is the only package shared by the browser and the server.
- `db`: Drizzle schema, `createDb`, the `db` singleton (`@workspace/db/client`, app only), migrations, the tenancy helpers (`organizationTable`, `organizationReference`, `organizationScope`), the Invitation token helpers (`createInvitationToken`, `hashInvitationToken`) and the seed (`@workspace/db/seed`). It also re-exports `drizzle-orm/sql` operators (`sql`, `eq`, …), so other packages import those from `@workspace/db`.
- `api`: tRPC routers and procedure tiers. It depends on `domain`, `db` and `auth`. `@workspace/api/headers` holds the request-header names and has no dependencies, so `proxy.ts` can import it.
- `auth`: Auth.js config and session helpers. `@workspace/auth` is framework-free (`getSessionFromHeaders`, `Session`, `resolveRedirect`) and safe in any server package; `@workspace/auth/next` is the Auth.js instance (`handlers`, `auth()`, `oauthProviders`), app only; `@workspace/auth/react` has client `signIn`/`signOut`; `@workspace/auth/env` is its env schema; `@workspace/auth/mailer` has the `Mailer` interface for every non-auth email, with `createSmtpMailer()` (the same SMTP settings as magic links) and `createMemoryMailer()` (an `outbox` array, for tests).
- `documents` (#21) is a placeholder.
- `apps/web`: calls the API only through tRPC: no Server Actions and no direct db access in components. The only route handlers are Auth.js, `/api/trpc`, Quote Document download and `/api/health`.

## UI layout (apps/web)

- Routes live under `app/hosts/<surface>/` (see Hosts and routing). Keep route files thin: a page fetches through tRPC and renders feature components.
- Feature components live in `components/<area>/`, one folder per feature area, named with the glossary term: `auth`, `organizations` (picker, no-access), `platform` (the Platform Admin console), `invitations` (accept page), `members` (Members page, `RoleSelect`), `shell` (sidebar, Organization switcher, user menu, `PageHeader`, `PlaceholderPage`, and the shared list and dialog pieces `ConfirmDialog`, `ListPagination`, `FilterSelect`), `accounts` (Accounts list, Account detail with Contacts), `catalog` (Products and Add-ons pages, CSV import), `resource-roles`, and later `quotes`, `settings`. Never one flat folder. Shared primitives come from `@workspace/ui/components/*`; add new ones with the shadcn CLI from `apps/web` (`pnpm dlx shadcn@latest add <name>`), which writes them to `packages/ui`.
- Pure helpers go in `lib/`, with Vitest tests next to them (`lib/*.test.ts`, run by `pnpm test`). `lib/urls.ts` (server only) builds absolute URLs between surfaces: `appUrl()`, `adminUrl()`, `organizationUrl(slug, path)`, `signInUrl(callbackUrl, { email? })`, `currentPath()`. Client components that need another surface's URL get `APP_URL`/`ROOT_DOMAIN` as props and call `surfaceOrigin` from `lib/hosts.ts`. `lib/money.ts` has `formatMoney(amount, currency)` (formats the decimal string without a float round trip), `isMoneyInput` and `trimMoney`. `lib/organization-access.ts` (server only) gives a page the Organization's currency and whether the caller may perform a policy action, to show or hide controls. `lib/format.ts` has `formatDate` (UTC, so server and client render the same text), and `lib/trpc-errors.ts` reads tRPC errors in client code (`errorMessage`, `errorCode`, `fieldErrors` for zod issues, `inUseOf` for a delete blocked by references).
- Forms use react-hook-form with `zodResolver` and a `Controller` per field rendering shadcn `Field`/`FieldLabel`/`FieldError` (see `components/platform/create-organization-dialog.tsx`). Validate with the same domain rules as the API (e.g. `checkSlug`); the API re-validates, so map `fieldErrors(error)` back with `form.setError` and put anything else in `errors.root`. Watch values with `useWatch`, not `form.watch` (the React Compiler lint rejects it). Confirmations of a finished action are `toast` from `sonner` (the `<Toaster />` is in the root layout).
- Organization pages render inside the shell from `app/hosts/org/[slug]/layout.tsx`. Each nav entry in `components/shell/nav.ts` has a page; a new feature replaces its `PlaceholderPage`. Admin-only pages check `membership.role` again on the server (see `settings/page.tsx`); hiding the nav entry is not a check.

## Hosts and routing

One app serves every subdomain. `apps/web/proxy.ts` resolves the Host header (`lib/hosts.ts`, pure, never the DB) and rewrites to that surface's route tree under `app/hosts/`:

- `app.<ROOT_DOMAIN>/x` → `app/hosts/app/x` (sign-in, check-email, Invitation acceptance at `/invitations/[token]`, the Organization picker at `/`).
- `admin.<ROOT_DOMAIN>/x` → `app/hosts/admin/x` (Platform Admin console; its layout signs in and refuses non–Platform Admins).
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
- The global identity tables (`users`, `auth_accounts`, `sessions`, `verification_tokens`) are in `packages/db/src/schema/auth.ts` and have no `organization_id`. `users.is_platform_admin` marks a Platform Admin. Auth.js's OAuth accounts table is `auth_accounts` (`schema.authAccounts`), because `accounts` is the business Account.

## Tenancy (ADR-0001)

- `organizations` (slug, name, `currency_code`) is the tenancy root. Slugs are DNS labels, unique, never reserved (check constraints) and immutable (a trigger rejects changes). `memberships` holds `(organization_id, user_id)` unique, `role` (`admin` | `manager` | `member`, pg enum `membership_role`) and `is_approver`. Platform Admin is `users.is_platform_admin`, and it grants no Organization access: support staff need a normal Membership.
- **Every business table** is declared with `organizationTable(name, columns, extra?)` from `@workspace/db` instead of `pgTable`. It adds `id` (UUIDv7), `organization_id` (→ organizations) and the unique `(organization_id, id)` key.
- **Every reference between business tables** is a composite FK via `organizationReference(t, t.xId, xTable)` in the extra config: `(organization_id, x_id) → x(organization_id, id)`. Keep `xId: uuid()` without `.references()`. Chain `.onDelete(...)` as needed, but never `set null` (it would null `organization_id`); nullable references just work. References to global tables (users) stay plain `.references()`. The full recipe and an example are in `packages/db/src/organization-table.ts`.
- **Access business rows only through the Organization scope.** In procedures that is `ctx.scope` (an `OrganizationScope`): `findById`, `findMany({ where, orderBy, limit })`, `insert`, `insertMany`, `update(table, id, changes)`, `delete(table, id)` and `transaction(fn)`. Every call is filtered by (or stamped with) the Organization, and `update` ignores `organizationId`/`id`. For joins, use `ctx.scope.db` and put `ctx.scope.where(table, …conditions)` on every business table in the query (see `routers/membership.ts`). A missing row comes back `undefined`; turn it into `NOT_FOUND`.
- Enum literals (`ROLES`, …) and the slug rules (`RESERVED_SLUGS`, `SLUG_PATTERN`, `checkSlug`) live only in `@workspace/domain`. The db builds its pg enum and check constraints from them, the API validates with them, and `lib/hosts.ts` resolves subdomains with `checkSlug`, so they can't drift.

## Invitations

- An Invitation (`invitations`, a business table) has an email (stored lowercase), a Role, a SHA-256 `token_hash` (the raw token only ever appears in the emailed link `APP_URL/invitations/<token>`), `expires_at` (7 days, `INVITATION_TTL_MS`), `accepted_at`/`accepted_by_id`, `revoked_at` and `invited_by_id`. It is *open* until accepted or revoked, and an Organization has at most one open Invitation per email (partial unique index).
- Issue and re-send only through `issueInvitation` / `reissueInvitation` in `packages/api/src/invitations.ts`, inside the command's transaction. They revoke an earlier open Invitation for the same email, refuse an existing member (CONFLICT), and send the email last, so a failed send keeps nothing. `invitationStatus(inv)` gives `pending | expired | accepted | revoked`.
- `invitation.byToken` is public (holding the token is the credential) and backs the accept page, which explains unusable links without sign-in. `invitation.accept` is authed and requires the signed-in User's email to equal the invited one (FORBIDDEN otherwise, so a forwarded link can't be used by someone else); expired, revoked or used → PRECONDITION_FAILED. It creates the Membership with the invited Role (an existing Membership is kept as it is) and returns the Organization, and the page then goes to its subdomain.
- Admins invite from the Members page (`invitation.create` with any Role). `resend` issues a new token (the old link stops working) and a fresh 7-day expiry, also for an expired Invitation; `revoke` is idempotent and refuses an accepted one.

## Environment

There is one root `.env`, templated by `.env.example`. Add every new variable in three places: `.env.example` (with a comment), the zod schema (`apps/web/env.ts`, or the owning package's `env.ts`), and `globalEnv` in `turbo.json`. In the app, read values with `env.X` from `@/env`. A package script that needs env runs through `pnpm with-env <cmd>`.

## Database and migrations

- Put schema files in `packages/db/src/schema/<area>.ts` and re-export each one from `schema/index.ts`. Use `id()` and `timestamps()` from `src/columns.ts`. Primary keys are UUIDv7, generated in the app because Postgres 17 has no `uuidv7()`.
- Write columns in camelCase in TS. `casing: "snake_case"` maps them to snake_case in SQL, so don't pass column names.
- Every business table has `organization_id`, and foreign keys between business tables are composite `(organization_id, id)` (ADR-0001).
- `pnpm db:seed` upserts demo data into `DATABASE_URL`: a Platform Admin (`platform@provus.local`), `acme` (USD) with `admin@`, `manager@`, `member@` and `approver@acme.test` (a Member who is an Approver), and `globex` with `admin@globex.test`, plus a pending Invitation to `acme` for `invitee@acme.test` at `http://app.localtest.me:3000/invitations/acme-demo-invitation`, `acme`'s demo Accounts with Contacts (`seed/accounts.ts`, from the Salesforce edition's data plan), and its Products, Add-ons and Resource Roles (`seed/catalog.ts`, from the old portal's sample CSVs). It is idempotent: every row is upserted by a natural key (email, slug, (Organization, User)), so it's safe to re-run and resets seeded rows only. For a clean slate, run `docker compose down -v`, then `pnpm services:up && pnpm db:migrate && pnpm db:seed`. Later areas add an idempotent `seed<Area>(tx, organizations)` step in `packages/db/src/seed/index.ts`.
- To change the schema: edit it, run `pnpm db:generate --name=<what>`, review and commit the SQL in `packages/db/migrations/`, then run `pnpm db:migrate`. API tests migrate the test database themselves, and `pnpm db:migrate:test` does it by hand. Never edit a migration that has already been committed; add a new one. `db:push` is for throwaway experiments only.
- Server code takes the `Db` type, which accepts the root client or a transaction. Calling `db.transaction()` inside a transaction creates a savepoint.

## Money (ADR-0002)

- Store money as `numeric(19,4)`, percentages as `numeric(7,4)` and quantities as `numeric(18,3)`. Postgres returns these as strings; wrap them with `Decimal` from `@workspace/domain`.
- Do all arithmetic with `Decimal`, never JS `number`. Keep values as strings at the API boundary.
- The server recomputes totals through the domain pricing engine and ignores totals sent by the client.

## Domain package API

Import from `@workspace/domain/<area>`; the root `@workspace/domain` re-exports every area. All functions are pure and take and return plain serialisable data.

- **Boundary types.** Decimal inputs accept `string | number | Decimal`, so pass Postgres `numeric` strings straight in. Decimal outputs are strings at their column's storage scale: money has 4 dp (`"1234.5000"`), percentages 4 dp, and quantities and Allocation amounts 3 dp. Compare them with `Decimal`.
- **Refusals.** Business refusals come back as values (`{ allowed: false, reason, message }` or `{ ok: false, reason, message }`), never as thrown errors. Map `reason` to a tRPC error code and show `message`.
- `enums`: `ROLES`, `QUOTE_STATUSES`, `APPROVAL_STEP_ACTIONS`, `TIME_PERIODS`, `PERIOD_TYPES`, `BILLING_UNITS`, `SOURCE_KINDS`, `CATALOG_ITEM_KINDS`, `DISCOUNT_KINDS` and `MILESTONE_TYPES`, as const arrays with matching union types. db enums and zod schemas are built from these arrays.
- `money`: `Decimal`, `currencyMinorUnit`, `roundToMinorUnit` (half-up), `sumDecimals`, and `toMoneyString`, `toPercentString` and `toQuantityString` for storage-scale strings.
- `pricing`: `priceQuote({ currency, lines, discount })` returns per-line totals and margins, Subtotal, discountAmount, Total, cost, Margin and marginPct. Call it after every command and persist the result. It also has `hoursPerTimePeriod` and `defaultLineItemQuantity`, which use the Organization's Hours Per Day.
- `status`: `nextStatus(status, action)`, `availableActions`, `isLocked`, `isTerminal`, `LOCKED_STATUSES`, and `canSubmit({ status, total })`, which gives the specific refusal reason.
- `policy`: `can(actor, action, quote?, settings?)` answers every permission question, for Quote actions and for Admin-only Organization actions. `checkDeletableStatuses` validates the deletable-status setting, and `DELETABLE_STATUS_OPTIONS` lists the statuses that may be in it.
- `dates`: dates are ISO `yyyy-MM-dd` strings (`IsoDate`) and never `Date`. Validate input with `isIsoDate`. The module also covers bucket maths (`periodTypeForTimePeriod`, `startOfPeriod`, `endOfPeriod`, `addPeriods`, `periodsBetween`, `periodStartsInRange`), `countWorkingDays` (Mon–Fri) and day arithmetic.
- `effort`: `distributeWholeUnits(total, weights)` splits a total into whole hours by largest remainder, and the parts always add up to the total exactly.
- `allocations`: planner rules. `checkAllocationAmount` checks the per-cell caps and requires whole numbers for Each. `applyAllocationEdits` applies one gesture's batch of cells atomically. `defaultAllocations` lays out a new Resource Role line; call it when the line is added. `resizeAllocatedEffort` changes the total Effort. `diffAllocations` returns the rows to upsert and delete. Each of these returns the Allocations together with the quantity (Σ Allocations) and the dates they imply, so persist all of them together.
- `schedule`: `changeQuoteDates` handles a Quote Shift (the default for a start move) or a clamp, and returns every line's new schedule plus an impact summary. Preview mode means the API does not persist that result. `changeLineItemStart` moves one line by lift-and-shift and trims at the Quote End Date.
- `phases`: `canPlacePhase` checks create and move, `validatePhaseTree` checks a whole tree (depth ≤ 3, no cycles), and `phaseSubtree` returns what a Phase delete removes.
- `organizations`: `RESERVED_SLUGS`, `SLUG_PATTERN`, `checkSlug(slug)` (format and reserved; uniqueness is the API's), `suggestSlug(name)`, `isCurrencyCode` and `supportedCurrencies()`. `enums` also has `ROLE_LABELS` for UI copy and emails.
- `members`: `checkMembershipChange(target, change, adminCount)`, the last-Admin guard (the last Admin can't be removed or given another Role, not even by themselves). The API applies it under a row lock on the Organization's Admin Memberships; the Members page uses it to disable controls.

## tRPC

- Add a router in `packages/api/src/routers/<area>.ts` and register it under its area name in `src/root.ts`.
- Build each procedure on the narrowest tier in `src/trpc.ts`, which documents the tiers:
  - `publicProcedure`: anyone.
  - `authedProcedure`: gives non-null `ctx.session` and `ctx.user`, and throws UNAUTHORIZED otherwise.
  - `organizationProcedure`: authed, plus a Membership in the request's Organization (from `x-organization-slug`). It adds `ctx.organization` (`id`, `slug`, `name`, `currencyCode`), `ctx.membership` (`id`, `role`, `isApprover`) and `ctx.scope`. All business data goes through this tier's `ctx.scope`.
  - `adminProcedure`: organization tier with Role = Admin.
  - `platformProcedure`: authed Platform Admin, with no Organization.
  - `permittedProcedure(action)`: organization tier where `can(ctx.actor, action)` allows an Organization action (`"members.manage"`, `"settings.manage"`, `"catalog.manage"`); FORBIDDEN with the policy's message otherwise. The organization tier also gives `ctx.actor` (`userId`, `role`, `isApprover`), the policy's `Actor`.
- The context also carries `ctx.mailer` (a `Mailer`; SMTP by default) and `ctx.appUrl` (APP_URL, for links in emails). `createTRPCContext` takes both as options, which is how tests capture email.
- Refusals are uniform, so they never reveal what exists: no session → UNAUTHORIZED; no slug header (e.g. called from `app.`) → BAD_REQUEST; an unknown Organization **or** no Membership → NOT_FOUND (identical); another Organization's record id → NOT_FOUND; a Member without the needed Role or Approver right, or a non–Platform Admin → FORBIDDEN.
- `organization.current` returns the request's Organization and Membership. `organization.listMine` (authed) lists the caller's Memberships for the picker and switcher. `membership.list` and `membership.byId` are the first scoped reads. `platform.listOrganizations` / `createOrganization` / `inviteAdmin` are the Platform Admin console. The Members page uses `membership.list` plus the `members.manage` commands `invitation.list` / `create` / `resend` / `revoke` and `membership.changeRole` / `setApprover` / `remove` (removal deletes only the Membership; the User and everything they own stay).
- Mutations are intention-revealing commands, one per user gesture, and each runs in one transaction (ADR-0003). Validate input with zod; shared building blocks (`emailInput`, `roleInput`, `slugInput`, `currencyInput`, `requiredText`, `optionalText` where blank means null and omitted means unchanged, `optionalEmail`, `money`, `paging`, `containsPattern` for ILIKE, `stripUndefined`) are in `src/inputs.ts`.
- Errors (`src/errors.ts`): `notFound(thing)`; `isUniqueViolation(error, constraint)` to turn a lost race on a unique index into CONFLICT; and `inUseError({ entity, name, counts, examples, suggestion })`, the CONFLICT for a delete blocked by references (Accounts, Catalog Items and Resource Roles used by Quotes). The errorFormatter exposes its details as `error.data.inUse` (`{ kind: "in_use", entity, name, counts: { quotes?, lineItems? }, examples, suggestion: "archive" | "deactivate" }`); the web app reads it with `inUseOf(error)` from `lib/trpc-errors.ts`, and `errorMessage(error)` for display.
- Lists page on the server: input `{ …filters, page, pageSize }`, output `{ rows, total, page, pageSize }` (see `account.list`). Pickers get their own procedure that hides archived/inactive rows (`account.listForPicker`).
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
  Signed-in callers use `createTestCaller(db, { user: await createUser(db) })`, which injects the session. To exercise the real cookie lookup instead, use `createSession(db, user)` and pass its `cookie` in `headers`. Fixtures live in `src/test/fixtures.ts` and are re-exported from `../test`. Add shared fixtures there rather than writing setup in each test (e.g. `createAccount(db, organization, overrides?)`, `createContact(db, account, overrides?)`, `createCatalogItem(db, organization, overrides?)`, `createResourceRole(db, organization, overrides?)`).
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
- Email: every test caller gets an in-memory mailer. To read what was sent, pass `mailer: createMemoryMailer()` to `createTestCaller`/`organizationCaller` and inspect `mailer.outbox`; `tokenFromEmail(message)` extracts the Invitation token from the accept link. `createInvitation(db, { organization, email?, role?, expiresAt?, acceptedAt?, revokedAt? })` inserts one directly and returns `{ invitation, token }`.
- Domain tests are table-driven Vitest in `packages/domain/src/**/*.test.ts`.

## Before committing

Run `pnpm typecheck`, `pnpm lint` and `pnpm test`. All three must pass: lint allows zero warnings, and the API tests need `pnpm services:up`.
