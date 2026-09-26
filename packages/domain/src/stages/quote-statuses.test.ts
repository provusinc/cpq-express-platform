import { describe, expect, it } from "vitest"

import {
  canAddQuoteStatus,
  canDeleteQuoteStatus,
  checkQuoteStatusColour,
  checkQuoteStatusName,
  QUOTE_STATUS_NAME_MAX,
  QUOTE_STATUSES_PER_STAGE_MAX,
  sameQuoteStatusName,
} from "./index"

describe("checkQuoteStatusName", () => {
  it.each([
    ["  Legal review ", [], { ok: true, name: "Legal review" }],
    ["", [], { ok: false, reason: "blank" }],
    ["   ", [], { ok: false, reason: "blank" }],
    ["x".repeat(QUOTE_STATUS_NAME_MAX), [], { ok: true }],
    [
      "x".repeat(QUOTE_STATUS_NAME_MAX + 1),
      [],
      { ok: false, reason: "too_long" },
    ],
    ["draft", ["Draft", "Won"], { ok: false, reason: "duplicate" }],
    [" WON ", ["Draft", "Won"], { ok: false, reason: "duplicate" }],
    ["Won back", ["Draft", "Won"], { ok: true }],
  ] as const)("%j (taken %j) → %j", (name, taken, expected) => {
    expect(checkQuoteStatusName(name, taken)).toMatchObject(expected)
  })
})

describe("sameQuoteStatusName", () => {
  it.each([
    ["Sent", " sent ", true],
    ["Sent", "Sent out", false],
  ])("%j vs %j → %j", (a, b, expected) => {
    expect(sameQuoteStatusName(a, b)).toBe(expected)
  })
})

describe("checkQuoteStatusColour", () => {
  it.each([
    [null, { ok: true, colour: null }],
    [undefined, { ok: true, colour: null }],
    ["", { ok: true, colour: null }],
    ["#D73434", { ok: true, colour: "#d73434" }],
    ["#123456", { ok: false, reason: "invalid_colour" }],
    ["red", { ok: false, reason: "invalid_colour" }],
  ] as const)("%j → %j", (colour, expected) => {
    expect(checkQuoteStatusColour(colour)).toMatchObject(expected)
  })
})

describe("canAddQuoteStatus", () => {
  it.each([
    [1, true],
    [QUOTE_STATUSES_PER_STAGE_MAX - 1, true],
    [QUOTE_STATUSES_PER_STAGE_MAX, false],
  ])("a Stage with %i Statuses → %j", (count, ok) => {
    expect(canAddQuoteStatus(count).ok).toBe(ok)
  })
})

describe("canDeleteQuoteStatus", () => {
  const status = { id: "a", stage: "draft" as const }
  it.each([
    [{ countInStage: 1, quoteCount: 0 }, "last_status"],
    [
      {
        countInStage: 1,
        quoteCount: 0,
        replacement: { id: "b", stage: "draft" as const },
      },
      "last_status",
    ],
    [{ countInStage: 2, quoteCount: 0 }, null],
    [{ countInStage: 2, quoteCount: 3 }, "replacement_required"],
    [
      {
        countInStage: 2,
        quoteCount: 3,
        replacement: { id: "b", stage: "draft" as const },
      },
      null,
    ],
    [
      {
        countInStage: 2,
        quoteCount: 0,
        replacement: { id: "b", stage: "lost" as const },
      },
      "replacement_other_stage",
    ],
    [
      {
        countInStage: 2,
        quoteCount: 1,
        replacement: { id: "a", stage: "draft" as const },
      },
      "replacement_same",
    ],
  ])("%j → %j", (input, reason) => {
    const result = canDeleteQuoteStatus({ status, ...input })
    expect(result.ok ? null : result.reason).toBe(reason)
  })
})
