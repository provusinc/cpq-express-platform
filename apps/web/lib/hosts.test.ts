import { describe, expect, it } from "vitest"

import { RESERVED_SLUGS } from "@workspace/db/schema"

import {
  internalPath,
  RESERVED_SUBDOMAINS,
  resolveHost,
  surfaceOrigin,
} from "./hosts"

const ROOT = "localtest.me"

describe("resolveHost", () => {
  it.each([
    ["app.localtest.me:3000", { kind: "app" }],
    ["APP.localtest.me", { kind: "app" }],
    ["admin.localtest.me:3000", { kind: "admin" }],
    ["acme.localtest.me:3000", { kind: "organization", slug: "acme" }],
    ["acme-2.localtest.me", { kind: "organization", slug: "acme-2" }],
    ["Globex.LocalTest.me", { kind: "organization", slug: "globex" }],
    // Reserved, nested or not a valid slug.
    ["www.localtest.me", { kind: "unknown" }],
    ["api.localtest.me", { kind: "unknown" }],
    ["status.localtest.me", { kind: "unknown" }],
    ["a.b.localtest.me", { kind: "unknown" }],
    ["-acme.localtest.me", { kind: "unknown" }],
    ["acme_.localtest.me", { kind: "unknown" }],
    [`${"a".repeat(64)}.localtest.me`, { kind: "unknown" }],
    // Not under the root domain.
    ["localtest.me:3000", { kind: "other" }],
    ["localhost:3000", { kind: "other" }],
    ["acme.localtest.me.evil.com", { kind: "other" }],
    ["evillocaltest.me", { kind: "other" }],
    [null, { kind: "other" }],
  ] as const)("%s → %o", (host, surface) => {
    expect(resolveHost(host, ROOT)).toEqual(surface)
  })

  it("never treats a reserved subdomain as an Organization", () => {
    for (const sub of RESERVED_SUBDOMAINS) {
      expect(resolveHost(`${sub}.${ROOT}`, ROOT).kind).not.toBe("organization")
    }
  })

  it("reserves the same slugs as the database", () => {
    expect([...RESERVED_SUBDOMAINS].sort()).toEqual([...RESERVED_SLUGS].sort())
  })
})

describe("internalPath", () => {
  it.each([
    [{ kind: "app" }, "/", "/hosts/app"],
    [{ kind: "app" }, "/sign-in", "/hosts/app/sign-in"],
    [{ kind: "admin" }, "/", "/hosts/admin"],
    [{ kind: "organization", slug: "acme" }, "/", "/hosts/org/acme"],
    [
      { kind: "organization", slug: "acme" },
      "/quotes",
      "/hosts/org/acme/quotes",
    ],
    [{ kind: "unknown" }, "/quotes", "not-found"],
    [{ kind: "other" }, "/", null],
  ] as const)("%o %s → %s", (surface, pathname, expected) => {
    expect(internalPath(surface, pathname)).toBe(expected)
  })
})

describe("surfaceOrigin", () => {
  it("keeps APP_URL's scheme and port", () => {
    const app = "http://app.localtest.me:3000"
    expect(
      surfaceOrigin(app, ROOT, { kind: "organization", slug: "acme" })
    ).toBe("http://acme.localtest.me:3000")
    expect(surfaceOrigin(app, ROOT, { kind: "admin" })).toBe(
      "http://admin.localtest.me:3000"
    )
    expect(
      surfaceOrigin("https://app.cpq.example.com", "cpq.example.com", {
        kind: "app",
      })
    ).toBe("https://app.cpq.example.com")
  })
})
