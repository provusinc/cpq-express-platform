import { describe, expect, it } from "vitest"

import {
  checkSlug,
  isCurrencyCode,
  isReservedSlug,
  RESERVED_SLUGS,
  suggestSlug,
} from "./index"

describe("checkSlug", () => {
  it.each(["acme", "acme-2", "a", "9lives", "a".repeat(63)])(
    "accepts %s",
    (slug) => {
      expect(checkSlug(slug)).toEqual({ ok: true })
    }
  )

  it.each([
    "",
    "Acme",
    "-acme",
    "acme-",
    "ac_me",
    "a.b",
    "acme corp",
    "a".repeat(64),
  ])("refuses the malformed slug %j", (slug) => {
    expect(checkSlug(slug)).toMatchObject({ ok: false, reason: "slug_format" })
  })

  it.each([...RESERVED_SLUGS])("refuses the reserved slug %s", (slug) => {
    expect(isReservedSlug(slug)).toBe(true)
    expect(checkSlug(slug)).toMatchObject({
      ok: false,
      reason: "slug_reserved",
    })
  })

  it("reserves exactly the platform subdomains", () => {
    expect([...RESERVED_SLUGS].sort()).toEqual(
      ["admin", "api", "app", "auth", "docs", "status", "www"].sort()
    )
  })
})

describe("isCurrencyCode", () => {
  it.each([
    ["USD", true],
    ["EUR", true],
    ["JPY", true],
    ["usd", false],
    ["US", false],
    ["XYZ", false],
  ])("%s → %s", (code, expected) => {
    expect(isCurrencyCode(code)).toBe(expected)
  })
})

describe("suggestSlug", () => {
  it.each([
    ["Acme Corporation", "acme-corporation"],
    ["  Acme  Corp. ", "acme-corp"],
    ["Café Zürich", "cafe-zurich"],
    ["AT&T", "at-t"],
    ["---", ""],
    ["x".repeat(62) + " y", "x".repeat(62)],
  ])("%j → %j", (name, slug) => {
    expect(suggestSlug(name)).toBe(slug)
  })
})
