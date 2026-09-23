import { describe, expect, it } from "vitest"

import { QUOTE_NAME_MAX, sameQuoteName, suggestQuoteName } from "./index"

describe("suggestQuoteName", () => {
  it.each([
    ["Initech", "2026-10-05", "Initech – Oct 2026"],
    ["  Globex  ", "2027-01-31", "Globex – Jan 2027"],
    [null, "2026-12-01", "Dec 2026"],
    ["", "2026-03-01", "Mar 2026"],
  ])("%s starting %s → %s", (account, start, expected) => {
    expect(suggestQuoteName(account, start)).toBe(expected)
  })

  it("keeps the month when the Account name is very long", () => {
    const name = suggestQuoteName("x".repeat(300), "2026-10-05")
    expect(name).toHaveLength(QUOTE_NAME_MAX)
    expect(name.endsWith(" – Oct 2026")).toBe(true)
  })
})

describe("sameQuoteName", () => {
  it("ignores case and surrounding spaces", () => {
    expect(sameQuoteName(" Pilot ", "pilot")).toBe(true)
    expect(sameQuoteName("Pilot", "Pilot 2")).toBe(false)
  })
})
