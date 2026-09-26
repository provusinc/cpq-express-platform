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
  checkEntryStatus,
  checkStatusChange,
  DEFAULT_QUOTE_STATUSES,
  isLifecycleAction,
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
  ["draft", "mark_lost", "lost"],
  ["approved", "mark_lost", "lost"],
  ["with_customer", "mark_lost", "lost"],
  ["lost", "reopen", "draft"],
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
    ["draft", ["submit", "mark_lost"], false],
    ["in_approval", ["approve", "reject", "recall"], false],
    ["approved", ["mark_sent", "mark_lost"], false],
    [
      "with_customer",
      ["customer_approved", "customer_rejected", "mark_lost"],
      false,
    ],
    ["won", [], true],
    ["lost", ["reopen"], true],
  ] as const)("%s offers %j (final: %s)", (stage, actions, final) => {
    expect(availableActions(stage)).toEqual(actions)
    expect(isTerminal(stage)).toBe(final)
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

describe("status changes", () => {
  it("never change the Stage and are the one non-lifecycle action", () => {
    for (const stage of QUOTE_STAGES) {
      expect(nextStage(stage, "status_change")).toBeNull()
      expect(availableActions(stage)).not.toContain("status_change")
    }
    expect(
      APPROVAL_STEP_ACTIONS.filter((action) => !isLifecycleAction(action))
    ).toEqual(["status_change"])
  })

  it("move only to another Status of the current Stage", () => {
    const quote = { stage: "in_approval" as const, statusId: "s1" }
    expect(
      checkStatusChange(quote, { id: "s2", stage: "in_approval" })
    ).toEqual({ ok: true })
    expect(
      checkStatusChange(quote, { id: "s3", stage: "approved" })
    ).toMatchObject({ ok: false, reason: "other_stage" })
    expect(
      checkStatusChange(quote, { id: "s1", stage: "in_approval" })
    ).toMatchObject({ ok: false, reason: "same_status" })
  })

  it("an entry Status must belong to the target Stage", () => {
    expect(checkEntryStatus("approved", { stage: "approved" })).toEqual({
      ok: true,
    })
    expect(checkEntryStatus("approved", { stage: "draft" })).toMatchObject({
      ok: false,
      reason: "other_stage",
    })
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
