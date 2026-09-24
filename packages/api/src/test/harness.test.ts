import { describe, expect, it } from "vitest"

import { sql } from "@workspace/db"
import type { Db } from "@workspace/db"

import { withTestDb } from "./index"

const probeExists = (db: Db) =>
  db
    .execute<{
      exists: boolean
    }>(sql`select to_regclass('harness_probe') is not null as exists`)
    .then((rows) => rows[0]?.exists)

describe("test harness", () => {
  it("rolls back everything a test wrote", async () => {
    await withTestDb(async (db) => {
      await db.execute(sql`create table harness_probe (n int)`)
      expect(await probeExists(db)).toBe(true)
    })
    await withTestDb(async (db) => {
      expect(await probeExists(db)).toBe(false)
    })
  })

  it("supports nested transactions as savepoints", async () => {
    await withTestDb(async (db) => {
      await db.execute(sql`create table harness_probe (n int)`)

      await db.transaction(async (tx) => {
        await tx.execute(sql`insert into harness_probe values (1)`)
      })
      await expect(
        db.transaction(async (tx) => {
          await tx.execute(sql`insert into harness_probe values (2)`)
          throw new Error("boom")
        })
      ).rejects.toThrow("boom")

      const rows = await db.execute<{ n: number }>(
        sql`select n from harness_probe order by n`
      )
      expect(rows.map((r) => r.n)).toEqual([1])
    })
  })
})
