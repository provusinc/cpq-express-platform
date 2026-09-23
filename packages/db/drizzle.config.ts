import { defineConfig } from "drizzle-kit"

// Loaded via `pnpm with-env` (root .env). drizzle-kit always targets DATABASE_URL;
// the test database is migrated with `pnpm db:migrate:test`, never pushed.
const url = process.env.DATABASE_URL
if (!url)
  throw new Error("DATABASE_URL is not set (copy .env.example to .env).")

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  casing: "snake_case",
  dbCredentials: { url },
  strict: true,
  verbose: true,
})
