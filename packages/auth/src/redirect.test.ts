import { describe, expect, it } from "vitest"

import { resolveRedirect } from "./redirect"

const policy = {
  appUrl: "http://app.localtest.me:3000",
  rootDomain: "localtest.me",
}
const base = "http://app.localtest.me:3000"

describe("resolveRedirect", () => {
  it.each([
    ["/", `${base}/`],
    ["/check-email?x=1", `${base}/check-email?x=1`],
    ["http://app.localtest.me:3000/x", "http://app.localtest.me:3000/x"],
    [
      "http://acme.localtest.me:3000/quotes",
      "http://acme.localtest.me:3000/quotes",
    ],
    ["http://admin.localtest.me:3000/", "http://admin.localtest.me:3000/"],
    ["http://localtest.me:3000/", "http://localtest.me:3000/"],
  ])("allows %s", (url, expected) => {
    expect(resolveRedirect(url, base, policy)).toBe(expected)
  })

  it.each([
    "https://evil.com/",
    "http://evil.com:3000/",
    "http://localtest.me.evil.com:3000/",
    "http://evillocaltest.me:3000/",
    "//evil.com/",
    "/\\evil.com",
    "https://acme.localtest.me:3000/", // wrong scheme
    "http://acme.localtest.me:4000/", // wrong port
    "http://user:pass@acme.localtest.me:3000/",
    "javascript:alert(1)",
    "not a url",
  ])("rejects %s", (url) => {
    expect(resolveRedirect(url, base, policy)).toBe(base)
  })
})
