import { describe, expect, it } from "vitest"

import { createTestCaller, withTestDb } from "../test"

describe("health.check", () => {
  it("reports the database as connected", () =>
    withTestDb(async (db) => {
      const caller = createTestCaller(db)

      const result = await caller.health.check()

      expect(result.status).toBe("ok")
      expect(result.database).toMatchObject({ connected: true })
      expect(result.checkedAt).toBeInstanceOf(Date)
    }))
})
