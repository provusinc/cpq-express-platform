import { describe, expect, it } from "vitest"

import {
  APPROVAL_STEP_ACTIONS,
  type ApprovalStepAction,
  QUOTE_STATUSES,
  type QuoteStatus,
} from "../enums"
import {
  availableActions,
  canSubmit,
  isLocked,
  isTerminal,
  nextStatus,
} from "./index"

/** The spec's transition table; every pair not listed is refused. */
const ALLOWED: Array<[QuoteStatus, ApprovalStepAction, QuoteStatus]> = [
  ["draft", "submit", "pending_approval"],
  ["pending_approval", "approve", "approved"],
  ["pending_approval", "reject", "rejected"],
  ["pending_approval", "recall", "draft"],
  ["rejected", "submit", "pending_approval"],
  ["approved", "mark_sent", "pending_customer_approval"],
  ["pending_customer_approval", "customer_approved", "customer_approved"],
  ["pending_customer_approval", "customer_rejected", "customer_rejected"],
  ["customer_rejected", "submit", "pending_approval"],
]

const ALL_PAIRS = QUOTE_STATUSES.flatMap((status) =>
  APPROVAL_STEP_ACTIONS.map((action) => [status, action] as const)
)

describe("nextStatus", () => {
  it.each(ALLOWED)("%s --%s--> %s", (from, action, to) => {
    expect(nextStatus(from, action)).toBe(to)
  })

  const refused = ALL_PAIRS.filter(
    ([status, action]) =>
      !ALLOWED.some(([s, a]) => s === status && a === action)
  )
  it.each(refused)("%s refuses %s", (status, action) => {
    expect(nextStatus(status, action)).toBeNull()
  })

  it("covers exactly the spec's transitions", () => {
    expect(refused).toHaveLength(ALL_PAIRS.length - ALLOWED.length)
  })
})

describe("availableActions / isTerminal", () => {
  it.each([
    ["draft", ["submit"]],
    ["pending_approval", ["approve", "reject", "recall"]],
    ["rejected", ["submit"]],
    ["approved", ["mark_sent"]],
    ["pending_customer_approval", ["customer_approved", "customer_rejected"]],
    ["customer_rejected", ["submit"]],
    ["customer_approved", []],
  ] as const)("%s offers %j", (status, actions) => {
    expect(availableActions(status)).toEqual(actions)
    expect(isTerminal(status)).toBe(actions.length === 0)
  })
})

// Ported from portal quote-utils.test.ts (isQuoteLockedForEditing), with the
// e-signature statuses replaced by the v1 customer statuses.
describe("isLocked", () => {
  it.each([
    ["draft", false],
    ["pending_approval", true],
    ["approved", true],
    ["rejected", false],
    ["pending_customer_approval", true],
    ["customer_approved", true],
    ["customer_rejected", false],
  ] as const)("%s → locked=%s", (status, locked) => {
    expect(isLocked(status)).toBe(locked)
  })
})

// Ported from portal quote-utils.test.ts (isQuoteStatusSubmittableForApproval)
// plus the v1 positive-Total precondition with specific reasons.
describe("canSubmit", () => {
  it.each([
    ["draft", "100", { ok: true }],
    ["rejected", "0.01", { ok: true }],
    ["customer_rejected", "5000.0000", { ok: true }],
    ["pending_approval", "100", { ok: false, reason: "wrong_status" }],
    ["approved", "100", { ok: false, reason: "wrong_status" }],
    ["pending_customer_approval", "100", { ok: false, reason: "wrong_status" }],
    ["customer_approved", "100", { ok: false, reason: "wrong_status" }],
    ["draft", null, { ok: false, reason: "total_missing" }],
    ["draft", undefined, { ok: false, reason: "total_missing" }],
    ["draft", "0", { ok: false, reason: "total_zero" }],
    ["draft", "0.0000", { ok: false, reason: "total_zero" }],
    ["rejected", "-1", { ok: false, reason: "total_negative" }],
  ] as const)("%s with Total %s → %o", (status, total, expected) => {
    expect(canSubmit({ status, total })).toMatchObject(expected)
  })

  it("reports the wrong status before the Total", () => {
    expect(canSubmit({ status: "approved", total: "0" })).toMatchObject({
      reason: "wrong_status",
    })
  })

  it("explains each refusal", () => {
    const result = canSubmit({ status: "draft", total: "0" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/zero/i)
  })
})
