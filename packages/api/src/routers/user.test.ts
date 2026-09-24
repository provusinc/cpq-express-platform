import { describe, expect, it } from "vitest"

import {
  createSession,
  createTestCaller,
  createUser,
  withTestDb,
} from "../test"

describe("authed procedures (user.me)", () => {
  it("rejects an anonymous caller with UNAUTHORIZED", () =>
    withTestDb(async (db) => {
      const caller = createTestCaller(db)

      await expect(caller.user.me()).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      })
    }))

  it("returns the signed-in User", () =>
    withTestDb(async (db) => {
      const user = await createUser(db, { email: "ada@example.test" })
      const caller = createTestCaller(db, { user })

      expect(await caller.user.me()).toEqual({
        id: user.id,
        email: "ada@example.test",
        name: user.name,
        image: null,
        isPlatformAdmin: false,
      })
    }))

  it("reads the session from the request's session cookie", () =>
    withTestDb(async (db) => {
      const user = await createUser(db)
      const { cookie } = await createSession(db, user)
      const caller = createTestCaller(db, {
        headers: {
          host: "acme.localtest.me:3000",
          cookie: `theme=dark; ${cookie}`,
        },
      })

      expect((await caller.user.me()).id).toBe(user.id)
    }))

  it("rejects an unknown or expired session cookie", () =>
    withTestDb(async (db) => {
      const user = await createUser(db)
      const { cookie } = await createSession(db, user, {
        expires: new Date(Date.now() - 1000),
      })

      for (const c of [cookie, "authjs.session-token=not-a-session"]) {
        const caller = createTestCaller(db, { headers: { cookie: c } })
        await expect(caller.user.me()).rejects.toMatchObject({
          code: "UNAUTHORIZED",
        })
      }
    }))
})

describe("user preferences", () => {
  it("defaults to the default Quote list layout", () =>
    withTestDb(async (db) => {
      const caller = createTestCaller(db, { user: await createUser(db) })
      expect(await caller.user.preferences()).toEqual({
        quoteListColumns: { order: [], hidden: [] },
      })
    }))

  it("saves the Quote list columns per User", () =>
    withTestDb(async (db) => {
      const ada = createTestCaller(db, { user: await createUser(db) })
      const bob = createTestCaller(db, { user: await createUser(db) })
      await ada.user.setQuoteListColumns({
        order: ["name", "account", "name"],
        hidden: ["description"],
      })
      await ada.user.setQuoteListColumns({
        order: ["account", "name"],
        hidden: ["owner"],
      })
      expect((await ada.user.preferences()).quoteListColumns).toEqual({
        order: ["account", "name"],
        hidden: ["owner"],
      })
      expect((await bob.user.preferences()).quoteListColumns).toEqual({
        order: [],
        hidden: [],
      })
    }))

  it("needs a signed-in User", () =>
    withTestDb(async (db) => {
      await expect(
        createTestCaller(db).user.setQuoteListColumns({ order: [], hidden: [] })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" })
    }))
})
