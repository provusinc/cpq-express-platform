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
 * Signed-in callers: `createTestCaller(db, { user: await createUser(db) })`
 * injects the session directly; `{ headers: { cookie } }` with a cookie from
 * `createSession` goes through the real cookie lookup instead.
 *
 * Code under test may call `db.transaction()` freely: inside the harness that
 * becomes a SAVEPOINT, so commit/rollback semantics are preserved.
 *
 * Fixtures live in `./fixtures` (re-exported here): `createUser`,
 * `createSession`, `createOrganization`, `createMembership`, `createMember`.
 *
 * Organization-tier procedures: `organizationCaller(db, { organization, user })`
 * calls as `user` on `organization`'s subdomain. Every such procedure that
 * takes a record id also gets an `expectIsolated` test (`./isolation`).
 */
import { createDb, TransactionRollbackError } from "@workspace/db"
import type { Db } from "@workspace/db"

import type { SessionUser } from "@workspace/auth"

import { ORGANIZATION_SLUG_HEADER } from "../headers"
import { createCaller } from "../root"
import { createTRPCContext } from "../trpc"
import { toSessionUser } from "./fixtures"

export {
  createMember,
  createMembership,
  createOrganization,
  createSession,
  createUser,
  toSessionUser,
} from "./fixtures"
export { expectIsolated, ISOLATION_CODES } from "./isolation"

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
  /**
   * Call as this signed-in User (a row from `createUser`, or a SessionUser).
   * Omit for an anonymous caller — unless `headers` carries a session cookie.
   */
  user?: SessionUser
  /** Request headers, e.g. `{ host: "acme.localtest.me", cookie }`. */
  headers?: HeadersInit
}

/** A server-side caller bound to `db` (normally the one from `withTestDb`). */
export function createTestCaller(db: Db, opts: TestCallerOptions = {}) {
  const headers = new Headers(opts.headers)
  const session = opts.user
    ? {
        user: toSessionUser(opts.user),
        expires: new Date(Date.now() + 60 * 60 * 1000),
      }
    : undefined
  return createCaller(() => createTRPCContext({ db, headers, session }))
}

export type TestCaller = ReturnType<typeof createTestCaller>

/**
 * A caller for `user` on `organization`'s subdomain (sets the Organization
 * slug header as the proxy does). `user` needn't be a member — that's how
 * refusals are tested.
 */
export function organizationCaller(
  db: Db,
  {
    organization,
    user,
    headers,
  }: {
    organization: { slug: string }
    user?: SessionUser
    headers?: HeadersInit
  }
) {
  const merged = new Headers(headers)
  merged.set(ORGANIZATION_SLUG_HEADER, organization.slug)
  return createTestCaller(db, { user, headers: merged })
}
