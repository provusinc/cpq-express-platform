import { describe, expect, it } from "vitest"

import { eq, schema } from "@workspace/db"
import type { Db } from "@workspace/db"

import {
  createMember,
  createOrganization,
  createQuote,
  createUser,
  organizationCaller,
  withTestDb,
} from "../test"

describe("quoteStatus.list", () => {
  it.each(["admin", "manager", "member"] as const)(
    "gives a %s the Organization's Statuses in Stage order",
    (role) =>
      withTestDb(async (db) => {
        const acme = await createOrganization(db)
        const { user } = await createMember(db, acme, { role })
        const statuses = await organizationCaller(db, {
          organization: acme,
          user,
        }).quoteStatus.list()
        expect(statuses.map((s) => [s.stage, s.name])).toEqual([
          ["draft", "Draft"],
          ["in_approval", "Pending Approval"],
          ["approved", "Approved"],
          ["with_customer", "Sent"],
          ["won", "Won"],
          ["lost", "Lost"],
        ])
        expect(statuses[0]).toMatchObject({ sequence: 0, colour: null })
      })
  )

  it("orders several Statuses of a Stage by sequence, then name", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const { user } = await createMember(db, acme)
      await db.insert(schema.quoteStatuses).values([
        {
          organizationId: acme.id,
          stage: "in_approval",
          name: "Legal",
          sequence: 2,
        },
        {
          organizationId: acme.id,
          stage: "in_approval",
          name: "Finance",
          sequence: 1,
        },
        {
          organizationId: acme.id,
          stage: "in_approval",
          name: "Board",
          sequence: 1,
          colour: "#112233",
        },
      ])
      const statuses = await organizationCaller(db, {
        organization: acme,
        user,
      }).quoteStatus.list()
      expect(
        statuses.filter((s) => s.stage === "in_approval").map((s) => s.name)
      ).toEqual(["Pending Approval", "Board", "Finance", "Legal"])
    }))

  it("lists only this Organization's Statuses, and refuses a non-member", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const globex = await createOrganization(db)
      const { user } = await createMember(db, acme)
      const { user: outsider } = await createMember(db, globex, {
        role: "admin",
        isApprover: true,
      })
      const mine = await organizationCaller(db, {
        organization: acme,
        user,
      }).quoteStatus.list()
      expect(mine).toHaveLength(6)
      for (const who of [outsider, await createUser(db)]) {
        await expect(
          organizationCaller(db, {
            organization: acme,
            user: who,
          }).quoteStatus.list()
        ).rejects.toMatchObject({ code: "NOT_FOUND" })
      }
    }))
})

describe("quote_statuses table", () => {
  /** Runs `fn` in a savepoint; returns the database's refusal, or null. */
  const refusal = async (db: Db, fn: (tx: Db) => Promise<unknown>) => {
    try {
      await db.transaction(async (tx) => {
        await fn(tx)
      })
    } catch (error) {
      return (
        (error as { cause?: { message?: string } }).cause?.message ?? "refused"
      )
    }
    return null
  }

  it("keeps a Quote's Stage and Status consistent, within its Organization", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const globex = await createOrganization(db)
      const { user } = await createMember(db, acme)
      const statuses = await organizationCaller(db, {
        organization: acme,
        user,
      }).quoteStatus.list()
      const approved = statuses.find((s) => s.stage === "approved")!
      const theirs = await organizationCaller(db, {
        organization: globex,
        user: (await createMember(db, globex)).user,
      }).quoteStatus.list()
      // A Status of another Stage.
      expect(
        await refusal(db, (tx) =>
          createQuote(tx, acme, {
            owner: user,
            stage: "draft",
            statusId: approved.id,
          })
        )
      ).toMatch(/quotes_status_id_fk/)
      // Another Organization's Status.
      expect(
        await refusal(db, (tx) =>
          createQuote(tx, acme, {
            owner: user,
            stage: "draft",
            statusId: theirs[0]!.id,
          })
        )
      ).toMatch(/quotes_status_id_fk/)
      // A Status in use can't be deleted (#33 moves its Quotes first).
      await createQuote(db, acme, { owner: user, stage: "approved" })
      expect(
        await refusal(db, (tx) =>
          tx
            .delete(schema.quoteStatuses)
            .where(eq(schema.quoteStatuses.id, approved.id))
        )
      ).toMatch(/quotes_status_id_fk/)
    }))

  it("refuses duplicate names (ignoring case), blank names and bad colours", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const insert = (
        values: Partial<typeof schema.quoteStatuses.$inferInsert>
      ) =>
        refusal(db, (tx) =>
          tx.insert(schema.quoteStatuses).values({
            organizationId: acme.id,
            stage: "draft",
            name: "Something",
            sequence: 1,
            ...values,
          })
        )
      expect(await insert({ name: "draft" })).not.toBeNull()
      expect(await insert({ name: "  " })).not.toBeNull()
      expect(await insert({ colour: "red" })).not.toBeNull()
      expect(await insert({ colour: "#ABCDEF" })).not.toBeNull()
      expect(await insert({ sequence: -1 })).not.toBeNull()
      expect(await insert({ colour: "#abcdef" })).toBeNull()
      // The same name is fine in another Organization.
      const globex = await createOrganization(db)
      expect(
        await refusal(db, (tx) =>
          tx.insert(schema.quoteStatuses).values({
            organizationId: globex.id,
            stage: "draft",
            name: "Something",
            sequence: 1,
          })
        )
      ).toBeNull()
    }))
})
