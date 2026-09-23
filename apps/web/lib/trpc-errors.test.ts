import { describe, expect, it } from "vitest"

import { errorCode, errorMessage, fieldErrors } from "./trpc-errors"

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
})
