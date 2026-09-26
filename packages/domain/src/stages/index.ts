import { Decimal } from "decimal.js"

import type { ApprovalStepAction, QuoteStage } from "../enums"
import type { DecimalInput } from "../money"

/**
 * The Quote Stage machine (ADR-0004). Every lifecycle action is an Approval
 * Step action; the table below is the only place that decides which Stage
 * it leads to. Who may perform an action is the permission policy's job
 * (`@workspace/domain/policy`). Valid Until never changes the Stage, and a
 * Quote Status (an Organization's label inside a Stage) carries no
 * behaviour: code reasons only about Stages.
 *
 * Rejection is not a Stage: an Approver's rejection and the customer's "no"
 * return the Quote to Draft, where it is Rejected (`isRejected`) until the
 * next Submission. Mark as Lost (`mark_lost`) ends a dead deal from Draft,
 * Approved or With Customer (a Quote In Approval is recalled first); only
 * `reopen` leaves Lost, back to Draft. Won is final: nothing leaves it.
 */
const TRANSITIONS: Readonly<
  Record<QuoteStage, Partial<Record<ApprovalStepAction, QuoteStage>>>
> = {
  draft: { submit: "in_approval", mark_lost: "lost" },
  in_approval: {
    approve: "approved",
    reject: "draft",
    recall: "draft",
  },
  approved: { mark_sent: "with_customer", mark_lost: "lost" },
  with_customer: {
    customer_approved: "won",
    customer_rejected: "draft",
    mark_lost: "lost",
  },
  won: {},
  lost: { reopen: "draft" },
}

/**
 * Stages in which a Quote is locked (not editable): every Stage but Draft.
 */
export const LOCKED_STAGES = [
  "in_approval",
  "approved",
  "with_customer",
  "won",
  "lost",
] as const satisfies readonly QuoteStage[]

/** The Stage `action` leads to from `stage`, or `null` if not allowed. */
export function nextStage(
  stage: QuoteStage,
  action: ApprovalStepAction
): QuoteStage | null {
  return TRANSITIONS[stage][action] ?? null
}

/** The actions available from `stage`, in table order. */
export function availableActions(stage: QuoteStage): ApprovalStepAction[] {
  return Object.keys(TRANSITIONS[stage]) as ApprovalStepAction[]
}

/**
 * The final Stages: the deal is decided (Won, Lost). Won has no way out;
 * only an Admin's reopen leaves Lost.
 */
export const FINAL_STAGES = [
  "won",
  "lost",
] as const satisfies readonly QuoteStage[]

/** True in a final Stage (Won, Lost). */
export function isTerminal(stage: QuoteStage): boolean {
  return (FINAL_STAGES as readonly QuoteStage[]).includes(stage)
}

/** The Stages a Quote can be marked as lost from (Draft, Approved, With Customer). */
export const MARK_LOST_STAGES = [
  "draft",
  "approved",
  "with_customer",
] as const satisfies readonly QuoteStage[]

/** True while the Quote may not be edited: every Stage but Draft. */
export function isLocked(stage: QuoteStage): boolean {
  return (LOCKED_STAGES as readonly QuoteStage[]).includes(stage)
}

/** The Approval Step actions that reject a Quote (an Approver, the customer). */
export const REJECTION_ACTIONS = [
  "reject",
  "customer_rejected",
] as const satisfies readonly ApprovalStepAction[]

/**
 * Glossary: Rejected. A fact, not a Status: a Draft Quote whose latest
 * Approval Step is a rejection (by an Approver or by the customer). It ends
 * at the next Submission.
 */
export function isRejected(quote: {
  stage: QuoteStage
  latestAction: ApprovalStepAction | null | undefined
}): boolean {
  return (
    quote.stage === "draft" &&
    !!quote.latestAction &&
    (REJECTION_ACTIONS as readonly ApprovalStepAction[]).includes(
      quote.latestAction
    )
  )
}

export type SubmitRefusal =
  | "wrong_stage"
  | "total_missing"
  | "total_zero"
  | "total_negative"

export type SubmitCheck =
  | { ok: true }
  | { ok: false; reason: SubmitRefusal; message: string }

/**
 * Submission preconditions that depend on the Quote alone (not on who asks):
 * the Quote must be in Draft (Rejected ones included), and the Total must be
 * positive. Each failure has its own reason.
 */
export function canSubmit(quote: {
  stage: QuoteStage
  total: DecimalInput | null | undefined
}): SubmitCheck {
  if (nextStage(quote.stage, "submit") === null) {
    return {
      ok: false,
      reason: "wrong_stage",
      message: "Only a Draft Quote can be submitted.",
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

// ─── Quote Statuses ─────────────────────────────────────────────────────────

/**
 * The Quote Statuses every Organization starts with: exactly one per Stage,
 * in Stage order (glossary: Quote Status). Entering a Stage lands a Quote on
 * that Stage's first Status.
 */
export const DEFAULT_QUOTE_STATUSES: readonly {
  stage: QuoteStage
  name: string
}[] = [
  { stage: "draft", name: "Draft" },
  { stage: "in_approval", name: "Pending Approval" },
  { stage: "approved", name: "Approved" },
  { stage: "with_customer", name: "Sent" },
  { stage: "won", name: "Won" },
  { stage: "lost", name: "Lost" },
]

/** The longest Quote Status name. */
export const QUOTE_STATUS_NAME_MAX = 40

/** Every Stage has at least one and at most this many Statuses. */
export const QUOTE_STATUSES_PER_STAGE_MAX = 10

/**
 * The colours an Admin may give a Quote Status: the status tones (grey,
 * blue, iris, green, amber, red) as `#rrggbb`. A Status without a colour
 * takes its Stage's tone.
 */
export const QUOTE_STATUS_COLOURS = [
  { colour: "#737373", label: "Grey" },
  { colour: "#1447e6", label: "Blue" },
  { colour: "#6a59cb", label: "Iris" },
  { colour: "#219761", label: "Green" },
  { colour: "#eb9f2c", label: "Amber" },
  { colour: "#d73434", label: "Red" },
] as const satisfies readonly { colour: string; label: string }[]

/** Whether two Quote Status names are the same (trimmed, ignoring case). */
export function sameQuoteStatusName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

export type QuoteStatusNameCheck =
  | { ok: true; name: string }
  | { ok: false; reason: "blank" | "too_long" | "duplicate"; message: string }

/**
 * Checks a Quote Status name: trimmed, not blank, at most
 * `QUOTE_STATUS_NAME_MAX` characters, and not one of `taken` (the
 * Organization's other Statuses' names, compared with
 * `sameQuoteStatusName`). Returns the trimmed name.
 */
export function checkQuoteStatusName(
  name: string,
  taken: readonly string[] = []
): QuoteStatusNameCheck {
  const trimmed = name.trim()
  if (!trimmed) {
    return { ok: false, reason: "blank", message: "Enter a name." }
  }
  if (trimmed.length > QUOTE_STATUS_NAME_MAX) {
    return {
      ok: false,
      reason: "too_long",
      message: `Use at most ${QUOTE_STATUS_NAME_MAX} characters.`,
    }
  }
  if (taken.some((other) => sameQuoteStatusName(other, trimmed))) {
    return {
      ok: false,
      reason: "duplicate",
      message: `A Quote Status named “${trimmed}” already exists.`,
    }
  }
  return { ok: true, name: trimmed }
}

export type QuoteStatusColourCheck =
  | { ok: true; colour: string | null }
  | { ok: false; reason: "invalid_colour"; message: string }

/** Checks a Quote Status colour: none, or one of `QUOTE_STATUS_COLOURS`. */
export function checkQuoteStatusColour(
  colour: string | null | undefined
): QuoteStatusColourCheck {
  if (colour == null || colour === "") return { ok: true, colour: null }
  const normalised = colour.trim().toLowerCase()
  if (!QUOTE_STATUS_COLOURS.some((option) => option.colour === normalised)) {
    return {
      ok: false,
      reason: "invalid_colour",
      message: "Pick one of the status colours.",
    }
  }
  return { ok: true, colour: normalised }
}

export type QuoteStatusChange =
  | { ok: true }
  | {
      ok: false
      reason:
        | "stage_full"
        | "last_status"
        | "replacement_required"
        | "replacement_same"
        | "replacement_other_stage"
      message: string
    }

/** Whether a Stage that has `count` Statuses can take another. */
export function canAddQuoteStatus(count: number): QuoteStatusChange {
  if (count >= QUOTE_STATUSES_PER_STAGE_MAX) {
    return {
      ok: false,
      reason: "stage_full",
      message: `A Stage can have at most ${QUOTE_STATUSES_PER_STAGE_MAX} Quote Statuses.`,
    }
  }
  return { ok: true }
}

/**
 * Whether a Status can be deleted: never the last of its Stage (it can be
 * renamed instead). A Status Quotes sit on (`quoteCount` > 0) needs a
 * `replacement`, another Status of the same Stage, which those Quotes move
 * to; an unused one needs none.
 */
export function canDeleteQuoteStatus({
  status,
  countInStage,
  quoteCount,
  replacement,
}: {
  status: { id: string; stage: QuoteStage }
  /** How many Statuses the Stage has, this one included. */
  countInStage: number
  /** How many Quotes sit on this Status. */
  quoteCount: number
  replacement?: { id: string; stage: QuoteStage } | null
}): QuoteStatusChange {
  if (countInStage <= 1) {
    return {
      ok: false,
      reason: "last_status",
      message:
        "Every Stage needs at least one Quote Status. Rename this one instead.",
    }
  }
  if (replacement) {
    if (replacement.id === status.id) {
      return {
        ok: false,
        reason: "replacement_same",
        message: "Pick another Quote Status as the replacement.",
      }
    }
    if (replacement.stage !== status.stage) {
      return {
        ok: false,
        reason: "replacement_other_stage",
        message: "The replacement must be a Quote Status of the same Stage.",
      }
    }
  } else if (quoteCount > 0) {
    return {
      ok: false,
      reason: "replacement_required",
      message: `${quoteCount} ${quoteCount === 1 ? "Quote is" : "Quotes are"} in this Status. Pick the Status to move ${quoteCount === 1 ? "it" : "them"} to.`,
    }
  }
  return { ok: true }
}
