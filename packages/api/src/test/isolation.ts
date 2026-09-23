import { expect } from "vitest"

import type { Db } from "@workspace/db"

import type { TestCaller } from "./index"
import { createMember, createOrganization } from "./fixtures"
import { organizationCaller } from "./index"

/** Codes an Organization-tier procedure may refuse a cross-Organization call with. */
export const ISOLATION_CODES = ["NOT_FOUND", "FORBIDDEN"] as const

/**
 * Tenancy isolation gate (ADR-0001). Asserts that a member of another
 * Organization cannot read or change a record owned by `owner`, even when
 * they know its id. Required for every organization-tier procedure that
 * takes a record id.
 *
 *   await expectIsolated(db, {
 *     owner: acme,
 *     call: (caller) => caller.account.byId({ id: acmeAccount.id }),
 *     // optional, for mutations: must read the same before and after
 *     snapshot: () => db.select().from(accounts).where(eq(accounts.id, acmeAccount.id)),
 *   })
 *
 * It creates a fresh outsider Organization with an Admin who is also an
 * Approver (the most privileged Membership), then makes `call` twice:
 * 1. on the outsider's own subdomain, with `owner`'s ids;
 * 2. on `owner`'s subdomain, where the outsider has no Membership.
 * Each must reject with NOT_FOUND or FORBIDDEN. Each call runs in a
 * savepoint that is always rolled back, so a leaking mutation can't disturb
 * the rest of the test. `snapshot` (if given) must read the same afterwards.
 *
 * A procedure with no record id (e.g. `organization.current`) legitimately
 * succeeds on the outsider's own subdomain; test its refusal on the owner's
 * subdomain directly with `organizationCaller` instead.
 */
export async function expectIsolated(
  db: Db,
  {
    owner,
    call,
    snapshot,
  }: {
    /** The Organization that owns the record. */
    owner: { id: string; slug: string }
    /** Invokes the procedure under test with the owner's record ids. */
    call: (caller: TestCaller) => Promise<unknown>
    /** Reads the record's observable state (compared before and after). */
    snapshot?: () => Promise<unknown>
  }
) {
  const outsider = await createOrganization(db, {
    name: "Outsider (isolation)",
  })
  const { user } = await createMember(db, outsider, {
    role: "admin",
    isApprover: true,
  })
  const before = snapshot ? await snapshot() : undefined

  const attempts = [
    { via: "their own Organization", organization: outsider },
    { via: "the owner's subdomain", organization: owner },
  ]
  for (const { via, organization } of attempts) {
    const outcome = await attemptInSavepoint(db, (tx) =>
      call(organizationCaller(tx, { organization, user }))
    )
    const who = `a member of another Organization, via ${via},`
    expect(outcome.rejected, `${who} was not refused`).toBe(true)
    if (outcome.rejected) {
      expect(
        ISOLATION_CODES,
        `${who} got ${String(outcome.code)} (${outcome.message})`
      ).toContain(outcome.code)
    }
  }

  if (snapshot) {
    expect(await snapshot(), "the owner's record changed").toEqual(before)
  }
}

class Rollback extends Error {}

async function attemptInSavepoint(
  db: Db,
  fn: (tx: Db) => Promise<unknown>
): Promise<
  | { rejected: false; value: unknown }
  | { rejected: true; code: unknown; message: string }
> {
  let outcome:
    | { rejected: false; value: unknown }
    | { rejected: true; code: unknown; message: string }
    | undefined
  try {
    await db.transaction(async (tx) => {
      try {
        outcome = { rejected: false, value: await fn(tx) }
      } catch (error) {
        outcome = {
          rejected: true,
          code: (error as { code?: unknown }).code,
          message: error instanceof Error ? error.message : String(error),
        }
      }
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }
  return outcome!
}
