import { describe, expect, it } from "vitest"

import {
  createSession,
  createTestCaller,
  createUser,
  withTestDb,
} from "../test"

describe("auth.getSession", () => {
  it("is null when signed out", () =>
    withTestDb(async (db) => {
      expect(await createTestCaller(db).auth.getSession()).toBeNull()
    }))

  it("carries the User and the Platform Admin flag", () =>
    withTestDb(async (db) => {
      const user = await createUser(db, { isPlatformAdmin: true })
      const { cookie } = await createSession(db, user)
      const session = await createTestCaller(db, {
        headers: { cookie },
      }).auth.getSession()

      expect(session?.user).toMatchObject({
        id: user.id,
        isPlatformAdmin: true,
      })
    }))
})
