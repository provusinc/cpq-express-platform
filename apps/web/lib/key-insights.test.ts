import { describe, expect, it } from "vitest"

import {
  insightFocusKey,
  insightFocusQuery,
  insightDays,
  insightListFilters,
  parseInsightFocus,
} from "./key-insights"
import type { InsightFocus } from "./key-insights"

describe("parseInsightFocus", () => {
  it.each([
    [{}, null],
    [{ insight: "low_margin" }, { kind: "insight", key: "low_margin" }],
    [{ insight: ["rejected", "x"] }, { kind: "insight", key: "rejected" }],
    [{ insight: "nope" }, null],
    [{ status: "in_approval" }, { kind: "stage", stage: "in_approval" }],
    [{ status: "DRAFT" }, null],
    // The old status names are not Stages.
    [{ status: "pending_approval" }, null],
    // An insight wins over a Stage.
    [
      { insight: "this_month", status: "draft" },
      { kind: "insight", key: "this_month" },
    ],
  ])("%j → %j", (params, expected) => {
    expect(parseInsightFocus(params)).toEqual(expected)
  })
})

describe("insightFocusQuery / insightFocusKey", () => {
  it.each([
    [null, "", "none"],
    [
      { kind: "insight", key: "pending_approval" },
      "?insight=pending_approval",
      "?insight=pending_approval",
    ],
    [
      { kind: "stage", stage: "approved" },
      "?status=approved",
      "?status=approved",
    ],
  ] as Array<[InsightFocus | null, string, string]>)(
    "%j",
    (focus, query, key) => {
      expect(insightFocusQuery(focus)).toBe(query)
      expect(insightFocusKey(focus)).toBe(key)
      // The query parses back to the same focus.
      expect(
        parseInsightFocus(Object.fromEntries(new URLSearchParams(query)))
      ).toEqual(focus)
    }
  )
})

describe("insightListFilters", () => {
  const month = "2026-09-01"
  const days = { thisMonthFrom: month, today: "2026-09-23" }
  it.each([
    [null, {}],
    [{ kind: "insight", key: "pending_approval" }, { stages: ["in_approval"] }],
    [
      { kind: "insight", key: "high_value_pipeline" },
      {
        stages: ["draft", "in_approval"],
        sort: { by: "total", direction: "desc" },
      },
    ],
    [
      { kind: "insight", key: "low_margin" },
      {
        stages: ["draft", "in_approval"],
        marginBelow: "15",
      },
    ],
    [
      { kind: "insight", key: "valid_until_soon" },
      {
        stages: ["draft", "in_approval", "approved", "with_customer"],
        validUntilFrom: "2026-09-23",
        validUntilTo: "2026-10-07",
        sort: { by: "validUntil", direction: "asc" },
      },
    ],
    [{ kind: "insight", key: "this_month" }, { createdFrom: month }],
    [{ kind: "insight", key: "rejected" }, { rejected: true }],
    [{ kind: "stage", stage: "won" }, { stages: ["won"] }],
  ] as Array<[InsightFocus | null, object]>)("%j", (focus, expected) => {
    expect(insightListFilters(focus, days)).toEqual(expected)
  })
})

describe("insightDays", () => {
  it("gives the UTC month start and day", () => {
    expect(insightDays(Date.parse("2026-09-30T23:30:00.000Z"))).toEqual({
      thisMonthFrom: "2026-09-01",
      today: "2026-09-30",
    })
  })
})
