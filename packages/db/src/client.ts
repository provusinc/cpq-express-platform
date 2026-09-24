import { createDb } from "./index"
import { dbEnv } from "./env"

// Reuse one pool across dev hot reloads.
const globalForDb = globalThis as unknown as {
  db?: ReturnType<typeof createDb>
}

/** Process-wide database client for the app, from `DATABASE_URL`. */
export const db = globalForDb.db ?? createDb(dbEnv().DATABASE_URL)

if (process.env.NODE_ENV !== "production") globalForDb.db = db
