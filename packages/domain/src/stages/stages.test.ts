import { describe, expect, it } from "vitest"

import {
  APPROVAL_STEP_ACTIONS,
  type ApprovalStepAction,
  QUOTE_STAGES,
  type QuoteStage,
} from "../enums"
import {
  availableActions,
  canSubmit,
  DEFAULT_QUOTE_STATUSES,
  isLocked,
  isRejected,
  isTerminal,
  nextStage,
} from "./index"

/** The spec's transition table; every pair not listed is refused. */
const ALLOWED: Array<[QuoteStage, ApprovalStepAction, QuoteStage]> = [
  ["draft", "submit", "in_approval"],
  ["in_approval", "approve", "approved"],
  ["in_approval", "reject", "draft"],
  ["in_approval", "recall", "draft"],
  ["approved", "mark_sent", "with_customer"],
  ["with_customer", "customer_approved", "won"],
  ["with_customer", "customer_rejected", "draft"],
]

const ALL_PAIRS = QUOTE_STAGES.flatMap((stage) =>
  APPROVAL_STEP_ACTIONS.map((action) => [stage, action] as const)
)

describe("nextStage", () => {
  it.each(ALLOWED)("%s --%s--> %s", (from, action, to) => {
    expect(nextStage(from, action)).toBe(to)
  })

  const refused = ALL_PAIRS.filter(
    ([stage, action]) => !ALLOWED.some(([s, a]) => s === stage && a === action)
  )
  it.each(refused)("%s refuses %s", (stage, action) => {
    expect(nextStage(stage, action)).toBeNull()
  })

  it("covers exactly the spec's transitions", () => {
    expect(refused).toHaveLength(ALL_PAIRS.length - ALLOWED.length)
  })
})

describe("availableActions / isTerminal", () => {
  it.each([
    ["draft", ["submit"]],
    ["in_approval", ["approve", "reject", "recall"]],
    ["approved", ["mark_sent"]],
    ["with_customer", ["customer_approved", "customer_rejected"]],
    ["won", []],
    ["lost", []],
  ] as const)("%s offers %j", (stage, actions) => {
    expect(availableActions(stage)).toEqual(actions)
    expect(isTerminal(stage)).toBe(actions.length === 0)
  })
})

describe("isLocked", () => {
  it.each([
    ["draft", false],
    ["in_approval", true],
    ["approved", true],
    ["with_customer", true],
    ["won", true],
    ["lost", true],
  ] as const)("%s → locked=%s", (stage, locked) => {
    expect(isLocked(stage)).toBe(locked)
  })
})

describe("isRejected", () => {
  it.each([
    ["draft", "reject", true],
    ["draft", "customer_rejected", true],
    ["draft", "recall", false],
    ["draft", null, false],
    ["in_approval", "submit", false],
    // Only a Draft Quote is Rejected.
    ["approved", "reject", false],
  ] as const)("%s after %s → %s", (stage, latestAction, expected) => {
    expect(isRejected({ stage, latestAction })).toBe(expected)
  })
})

describe("canSubmit", () => {
  it.each([
    ["draft", "100", { ok: true }],
    ["draft", "0.01", { ok: true }],
    ["in_approval", "100", { ok: false, reason: "wrong_stage" }],
    ["approved", "100", { ok: false, reason: "wrong_stage" }],
    ["with_customer", "100", { ok: false, reason: "wrong_stage" }],
    ["won", "100", { ok: false, reason: "wrong_stage" }],
    ["lost", "100", { ok: false, reason: "wrong_stage" }],
    ["draft", null, { ok: false, reason: "total_missing" }],
    ["draft", undefined, { ok: false, reason: "total_missing" }],
    ["draft", "0", { ok: false, reason: "total_zero" }],
    ["draft", "0.0000", { ok: false, reason: "total_zero" }],
    ["draft", "-1", { ok: false, reason: "total_negative" }],
  ] as const)("%s with Total %s → %o", (stage, total, expected) => {
    expect(canSubmit({ stage, total })).toMatchObject(expected)
  })

  it("reports the wrong Stage before the Total", () => {
    expect(canSubmit({ stage: "approved", total: "0" })).toMatchObject({
      reason: "wrong_stage",
    })
  })

  it("explains each refusal", () => {
    const result = canSubmit({ stage: "draft", total: "0" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/zero/i)
  })
})

describe("DEFAULT_QUOTE_STATUSES", () => {
  it("has exactly one Status per Stage, in Stage order", () => {
    expect(DEFAULT_QUOTE_STATUSES.map((s) => s.stage)).toEqual([
      ...QUOTE_STAGES,
    ])
    expect(DEFAULT_QUOTE_STATUSES.map((s) => s.name)).toEqual([
      "Draft",
      "Pending Approval",
      "Approved",
      "Sent",
      "Won",
      "Lost",
    ])
  })
})
