import path from "node:path"
import { fileURLToPath } from "node:url"
import { migrate } from "drizzle-orm/postgres-js/migrator"

import { createDb } from "./index"

export const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../migrations"
)

/** Apply all committed SQL migrations in `packages/db/migrations` to `url`. */
export async function runMigrations(url: string) {
  const db = createDb(url, { max: 1 })
  try {
    await migrate(db, { migrationsFolder })
  } finally {
    await db.$client.end()
  }
}

// CLI: `pnpm db:migrate` (DATABASE_URL) / `pnpm db:migrate:test` (TEST_DATABASE_URL)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const test = process.argv.includes("--test")
  const name = test ? "TEST_DATABASE_URL" : "DATABASE_URL"
  const url = process.env[name]
  if (!url) {
    console.error(`${name} is not set (copy .env.example to .env).`)
    process.exit(1)
  }
  await runMigrations(url)
  console.log(`Migrations applied to ${new URL(url).pathname.slice(1)}.`)
}
