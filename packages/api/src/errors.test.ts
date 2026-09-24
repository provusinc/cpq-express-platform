import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import { describe, expect, it } from "vitest"

import type { Db } from "@workspace/db"

import { inUseError } from "./errors"
import { createTRPCContext, createTRPCRouter, publicProcedure } from "./trpc"

// A router that refuses a delete the way feature routers do.
const router = createTRPCRouter({
  blocked: publicProcedure.mutation(() => {
    throw inUseError({
      entity: "account",
      name: "Initech",
      counts: { quotes: 7 },
      examples: ["A", "B", "C", "D", "E", "F", "G"],
      suggestion: "archive",
    })
  }),
})

/** Calls `blocked` over HTTP, as the browser does, and returns the error. */
async function callOverHttp() {
  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: new Request("http://localhost/api/trpc/blocked", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
    router,
    createContext: () =>
      createTRPCContext({
        db: undefined as unknown as Db,
        headers: new Headers(),
        session: null,
      }),
  })
  const body = (await response.json()) as {
    error: { json: { message: string; data: Record<string, unknown> } }
  }
  return { status: response.status, error: body.error.json }
}

describe("inUseError", () => {
  it("reaches the client as CONFLICT with structured data.inUse", async () => {
    const { status, error } = await callOverHttp()
    expect(status).toBe(409)
    expect(error.message).toBe(
      "“Initech” is used by 7 Quotes (A, B, C, D, E). Archive it instead."
    )
    expect(error.data).toMatchObject({
      code: "CONFLICT",
      inUse: {
        kind: "in_use",
        entity: "account",
        name: "Initech",
        counts: { quotes: 7 },
        examples: ["A", "B", "C", "D", "E"],
        suggestion: "archive",
      },
    })
  })
})
