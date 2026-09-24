import { Decimal } from "decimal.js"

import type { ApprovalStepAction, QuoteStatus } from "../enums"
import type { DecimalInput } from "../money"

/**
 * The Quote Status machine. Every lifecycle action is an Approval Step action;
 * the table below is the only place that decides which status it leads to.
 * Who may perform an action is the permission policy's job
 * (`@workspace/domain/policy`). Valid Until never changes status.
 */
const TRANSITIONS: Readonly<
  Record<QuoteStatus, Partial<Record<ApprovalStepAction, QuoteStatus>>>
> = {
  draft: { submit: "pending_approval" },
  pending_approval: {
    approve: "approved",
    reject: "rejected",
    recall: "draft",
  },
  rejected: { submit: "pending_approval" },
  approved: { mark_sent: "pending_customer_approval" },
  pending_customer_approval: {
    customer_approved: "customer_approved",
    customer_rejected: "customer_rejected",
  },
  customer_rejected: { submit: "pending_approval" },
  customer_approved: {},
}

/**
 * Statuses in which a Quote is locked (not editable). They are also the
 * committed statuses, which may never be in an Organization's deletable set.
 */
export const LOCKED_STATUSES = [
  "pending_approval",
  "approved",
  "pending_customer_approval",
  "customer_approved",
] as const satisfies readonly QuoteStatus[]

/** Statuses from which a Quote may be submitted for approval. */
export const SUBMITTABLE_STATUSES = [
  "draft",
  "rejected",
  "customer_rejected",
] as const satisfies readonly QuoteStatus[]

/** The status `action` leads to from `status`, or `null` if not allowed. */
export function nextStatus(
  status: QuoteStatus,
  action: ApprovalStepAction
): QuoteStatus | null {
  return TRANSITIONS[status][action] ?? null
}

/** The actions available from `status`, in table order. */
export function availableActions(status: QuoteStatus): ApprovalStepAction[] {
  return Object.keys(TRANSITIONS[status]) as ApprovalStepAction[]
}

/** True when `status` has no outgoing transitions (Customer Approved). */
export function isTerminal(status: QuoteStatus): boolean {
  return availableActions(status).length === 0
}

/** True while the Quote may not be edited. */
export function isLocked(status: QuoteStatus): boolean {
  return (LOCKED_STATUSES as readonly QuoteStatus[]).includes(status)
}

export type SubmitRefusal =
  | "wrong_status"
  | "total_missing"
  | "total_zero"
  | "total_negative"

export type SubmitCheck =
  | { ok: true }
  | { ok: false; reason: SubmitRefusal; message: string }

/**
 * Submission preconditions that depend on the Quote alone (not on who asks):
 * the status must be Draft, Rejected or Customer Rejected, and the Total must
 * be positive. Each failure has its own reason.
 */
export function canSubmit(quote: {
  status: QuoteStatus
  total: DecimalInput | null | undefined
}): SubmitCheck {
  if (nextStatus(quote.status, "submit") === null) {
    return {
      ok: false,
      reason: "wrong_status",
      message:
        "Only a Draft, Rejected or Customer Rejected Quote can be submitted.",
    }
  }
  if (quote.total === null || quote.total === undefined) {
    return {
      ok: false,
      reason: "total_missing",
      message: "The Quote has no Total yet. Add Line Items before submitting.",
    }
  }
  const total = new Decimal(quote.total)
  if (total.isZero()) {
    return {
      ok: false,
      reason: "total_zero",
      message: "A Quote with a zero Total can't be submitted.",
    }
  }
  if (total.isNegative()) {
    return {
      ok: false,
      reason: "total_negative",
      message: "A Quote with a negative Total can't be submitted.",
    }
  }
  return { ok: true }
}
