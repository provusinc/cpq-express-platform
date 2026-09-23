import { describe, expect, it } from "vitest"

import {
  insightFocusKey,
  insightFocusQuery,
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
    [{ status: "draft" }, { kind: "status", status: "draft" }],
    [{ status: "DRAFT" }, null],
    // An insight wins over a status.
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
      { kind: "status", status: "approved" },
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
  it.each([
    [null, {}],
    [{ kind: "insight", key: "pending_approval" }, { statuses: ["pending_approval"] }],
    [
      { kind: "insight", key: "high_value_pipeline" },
      {
        statuses: ["draft", "pending_approval"],
        sort: { by: "total", direction: "desc" },
      },
    ],
    [
      { kind: "insight", key: "low_margin" },
      {
        statuses: ["draft", "pending_approval", "pending_customer_approval"],
        marginBelow: "15",
      },
    ],
    [{ kind: "insight", key: "this_month" }, { createdFrom: month }],
    [
      { kind: "insight", key: "rejected" },
      { statuses: ["rejected", "customer_rejected"] },
    ],
    [{ kind: "status", status: "approved" }, { statuses: ["approved"] }],
  ] as Array<[InsightFocus | null, object]>)("%j", (focus, expected) => {
    expect(insightListFilters(focus, month)).toEqual(expected)
  })
})
