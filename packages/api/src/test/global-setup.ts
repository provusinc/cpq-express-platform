import { runMigrations } from "@workspace/db/migrate"

/** Runs once per `vitest` invocation: apply all migrations to the test database. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Copy .env.example to .env and run `pnpm services:up`."
    )
  }
  await runMigrations(url)
}
