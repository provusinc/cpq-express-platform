/**
 * Drizzle schema, split one file per area (e.g. `organizations.ts`,
 * `catalog.ts`, `quotes.ts`). Re-export every area file from here: this file
 * is what drizzle-kit reads and what `createDb` registers for relational queries.
 *
 * No tables yet — the first ones land with auth and tenancy (#3).
 */
export {}
