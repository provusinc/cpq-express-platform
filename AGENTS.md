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
- `api`: tRPC routers and procedure tiers. It depends on `domain` and `db`.
- `auth` (#3) and `documents` (#21) are placeholders.
- `apps/web`: UI organised by feature area (`components/<area>/`). It calls the API only through tRPC: no Server Actions and no direct db access in components. The only route handlers are Auth.js, `/api/trpc`, Quote Document download and `/api/health`.

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

## tRPC

- Add a router in `packages/api/src/routers/<area>.ts` and register it under its area name in `src/root.ts`.
- Build each procedure on the narrowest tier in `src/trpc.ts`, which documents the tiers. Business data always goes through the organization tier's scoped access (from #4).
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
  Extend the harness with shared fixtures (Users, Organizations, Memberships) instead of writing setup in each test.
- Domain tests are table-driven Vitest in `packages/domain/src/**/*.test.ts`.

## Before committing

Run `pnpm typecheck`, `pnpm lint` and `pnpm test`. All three must pass: lint allows zero warnings, and the API tests need `pnpm services:up`.
