import { describe, expect, it } from "vitest"

import { errorCode, errorMessage, fieldErrors, inUseOf } from "./trpc-errors"

const validation = {
  message: '[{"code":"custom"}]',
  data: {
    code: "BAD_REQUEST",
    zodError: {
      formErrors: [],
      fieldErrors: { slug: ["Reserved.", "Other."], name: undefined },
    },
  },
}

describe("tRPC error helpers", () => {
  it("reads field errors from a validation failure", () => {
    expect(fieldErrors(validation)).toEqual({ slug: "Reserved." })
    expect(errorMessage(validation)).toBe("Reserved.")
    expect(errorCode(validation)).toBe("BAD_REQUEST")
  })

  it("uses the message of any other error", () => {
    const conflict = {
      message: "Taken.",
      data: { code: "CONFLICT", zodError: null },
    }
    expect(errorMessage(conflict)).toBe("Taken.")
    expect(fieldErrors(conflict)).toEqual({})
    expect(errorCode(conflict)).toBe("CONFLICT")
  })

  it("falls back for anything else", () => {
    expect(errorMessage(undefined)).toMatch(/Something went wrong/)
    expect(errorMessage(new Error(""), "Nope.")).toBe("Nope.")
    expect(errorCode(new Error("x"))).toBeUndefined()
  })

  it("hides internal error messages", () => {
    expect(
      errorMessage({
        message: "relation does not exist",
        data: { code: "INTERNAL_SERVER_ERROR" },
      })
    ).toBe("Something went wrong. Try again.")
  })
})

describe("inUseOf", () => {
  const inUse = {
    kind: "in_use",
    entity: "account",
    name: "Initech",
    counts: { quotes: 2 },
    examples: ["A", "B"],
    suggestion: "archive",
  }

  it("reads the details of a blocked delete", () => {
    const error = {
      message: "“Initech” is used by 2 Quotes (A, B). Archive it instead.",
      data: { code: "CONFLICT", inUse },
    }
    expect(inUseOf(error)).toEqual(inUse)
    expect(errorMessage(error)).toMatch(/Archive it instead/)
  })

  it.each([
    [null],
    [new Error("boom")],
    [{ data: { code: "CONFLICT", inUse: null } }],
  ])("returns null for other errors (%o)", (error) => {
    expect(inUseOf(error)).toBeNull()
  })
})
