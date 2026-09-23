/**
 * API test harness. Tests call routers through the server-side caller against
 * the real test database (TEST_DATABASE_URL); every test runs inside a
 * transaction that is rolled back, so tests never see each other's rows.
 *
 *   it("reports connectivity", () =>
 *     withTestDb(async (db) => {
 *       const caller = createTestCaller(db)
 *       expect((await caller.health.check()).status).toBe("ok")
 *     }))
 *
 * Code under test may call `db.transaction()` freely: inside the harness that
 * becomes a SAVEPOINT, so commit/rollback semantics are preserved.
 *
 * Fixtures (users, Organizations, Memberships) and session-aware callers are
 * added here by the auth/tenancy tickets.
 */
import { createDb, TransactionRollbackError } from "@workspace/db"
import type { Db } from "@workspace/db"

import { createCaller } from "../root"
import { createTRPCContext } from "../trpc"

let testDb: ReturnType<typeof createDb> | undefined

function getTestDb() {
  if (!testDb) {
    const url = process.env.TEST_DATABASE_URL
    if (!url) throw new Error("TEST_DATABASE_URL is not set.")
    testDb = createDb(url, { max: 4 })
  }
  return testDb
}

/** Closes this worker's pool (registered in setup.ts). */
export async function closeTestDb() {
  await testDb?.$client.end()
  testDb = undefined
}

/**
 * Runs `fn` with a transaction-scoped `Db` and always rolls it back.
 * Returns whatever `fn` returns; errors from `fn` propagate.
 */
export async function withTestDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  let result: T | undefined
  try {
    await getTestDb().transaction(async (tx) => {
      result = await fn(tx)
      tx.rollback()
    })
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error
  }
  return result as T
}

export interface TestCallerOptions {
  /** Request headers, e.g. `{ host: "acme.localtest.me" }`. */
  headers?: HeadersInit
}

/** A server-side caller bound to `db` (normally the one from `withTestDb`). */
export function createTestCaller(db: Db, opts: TestCallerOptions = {}) {
  return createCaller(
    createTRPCContext({ db, headers: new Headers(opts.headers) })
  )
}
