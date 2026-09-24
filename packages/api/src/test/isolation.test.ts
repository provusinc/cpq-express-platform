import { describe, expect, it } from "vitest"

import {
  createMember,
  createOrganization,
  expectIsolated,
  withTestDb,
} from "./index"

describe("expectIsolated", () => {
  it("fails when the call is not refused", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      await expect(
        expectIsolated(db, { owner: acme, call: async () => "leaked" })
      ).rejects.toThrow(/was not refused/)
    }))

  it("fails on a refusal other than NOT_FOUND / FORBIDDEN", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      await expect(
        expectIsolated(db, {
          owner: acme,
          call: async () => {
            throw Object.assign(new Error("boom"), {
              code: "INTERNAL_SERVER_ERROR",
            })
          },
        })
      ).rejects.toThrow(/INTERNAL_SERVER_ERROR/)
    }))

  it("fails when the owner's record changed", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const { membership } = await createMember(db, acme)
      let reads = 0
      await expect(
        expectIsolated(db, {
          owner: acme,
          call: (caller) => caller.membership.byId({ id: membership.id }),
          snapshot: async () => ++reads,
        })
      ).rejects.toThrow(/record changed/)
    }))

  it("passes for a procedure that refuses outsiders", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const { membership } = await createMember(db, acme)
      await expectIsolated(db, {
        owner: acme,
        call: (caller) => caller.membership.byId({ id: membership.id }),
      })
    }))
})
