import type { ApprovalStepAction, QuoteStage, Role } from "../enums"
import type { DecimalInput } from "../money"
import { canSubmit, isLocked, nextStage } from "../stages"

/**
 * The permission policy: one function, `can`, answers every "may this
 * Membership do that?" question, with a specific reason when the answer is no.
 * The API re-checks it inside every command; the UI uses it to hide or
 * disable controls.
 */

/** Who is asking: the caller's Membership in the current Organization. */
export interface Actor {
  userId: string
  role: Role
  isApprover: boolean
}

/** What the policy needs to know about a Quote. */
export interface QuoteFacts {
  /** The Quote Owner (its creator, never transferred). */
  ownerId: string
  /**
   * The owner's current Role in this Organization, or `null` when they are no
   * longer a member. A removed member stays the owner; their Quotes follow the
   * Role rules for everyone else (so only Admins can edit them).
   */
  ownerRole: Role | null
  /** The Quote's Stage (its Status carries no behaviour). */
  stage: QuoteStage
  /** The persisted Total; only read for `quote.submit`. */
  total?: DecimalInput | null
}

/** The Organization settings the policy reads. */
export interface PolicySettings {
  /**
   * Stages in which Quotes may be deleted (only Draft and Lost can be;
   * any other Stage is ignored).
   */
  deletableStages: readonly QuoteStage[]
}

export const QUOTE_ACTIONS = [
  "quote.edit",
  "quote.delete",
  "quote.submit",
  "quote.approve",
  "quote.reject",
  "quote.recall",
  "quote.markSent",
  "quote.recordCustomerOutcome",
] as const
export type QuoteAction = (typeof QUOTE_ACTIONS)[number]

export const ORGANIZATION_ACTIONS = [
  "settings.manage",
  "catalog.manage",
  "members.manage",
] as const
export type OrganizationAction = (typeof ORGANIZATION_ACTIONS)[number]

export type Action = QuoteAction | OrganizationAction

export type DenialReason =
  | "admin_only"
  | "owner_only"
  | "owner_or_admin_only"
  | "not_allowed_to_edit"
  | "approver_only"
  | "self_approval"
  | "locked"
  | "wrong_stage"
  | "stage_not_deletable"
  | "total_missing"
  | "total_zero"
  | "total_negative"

export type Decision =
  | { allowed: true }
  | { allowed: false; reason: DenialReason; message: string }

/**
 * Stages an Admin may put in the deletable set: Draft ("Draft Quotes may be
 * deleted") and Lost ("Lost Quotes may be deleted"). Quotes in any other
 * Stage are committed and can never be deleted.
 */
export const DELETABLE_STAGE_OPTIONS = [
  "draft",
  "lost",
] as const satisfies readonly QuoteStage[]

/** The deletable set a new Organization starts with: Draft on, Lost off. */
export const DEFAULT_DELETABLE_STAGES: readonly QuoteStage[] = ["draft"]

/**
 * Split a proposed deletable set into what may be kept and what is refused
 * (committed Stages). Settings commands reject when `refused` is non-empty.
 */
export function checkDeletableStages(stages: readonly QuoteStage[]): {
  accepted: QuoteStage[]
  refused: QuoteStage[]
} {
  const options = DELETABLE_STAGE_OPTIONS as readonly QuoteStage[]
  const unique = [...new Set(stages)]
  return {
    accepted: unique.filter((s) => options.includes(s)),
    refused: unique.filter((s) => !options.includes(s)),
  }
}

const ALLOW: Decision = { allowed: true }

function deny(reason: DenialReason, message: string): Decision {
  return { allowed: false, reason, message }
}

/** May `actor` perform an Organization-wide action? */
export function can(actor: Actor, action: OrganizationAction): Decision
/** May `actor` perform `action` on this Quote? */
export function can(
  actor: Actor,
  action: QuoteAction,
  quote: QuoteFacts,
  settings?: PolicySettings
): Decision
export function can(
  actor: Actor,
  action: Action,
  quote?: QuoteFacts,
  settings?: PolicySettings
): Decision {
  if (isOrganizationAction(action)) {
    return actor.role === "admin"
      ? ALLOW
      : deny("admin_only", "Only an Admin can do this.")
  }
  if (!quote) {
    throw new TypeError(`can(${action}) needs the Quote's facts`)
  }
  switch (action) {
    case "quote.edit":
      return canEdit(actor, quote)
    case "quote.delete":
      return canDelete(actor, quote, settings)
    case "quote.submit":
      return canSubmitQuote(actor, quote)
    case "quote.approve":
      return canDecide(actor, quote, "approve")
    case "quote.reject":
      return canDecide(actor, quote, "reject")
    case "quote.recall":
      return ownerOrAdminFrom(actor, quote, "recall")
    case "quote.markSent":
      return ownerOrAdminFrom(actor, quote, "mark_sent")
    case "quote.recordCustomerOutcome":
      return ownerOrAdminFrom(actor, quote, "customer_approved")
  }
}

function isOrganizationAction(action: Action): action is OrganizationAction {
  return (ORGANIZATION_ACTIONS as readonly string[]).includes(action)
}

function isOwner(actor: Actor, quote: QuoteFacts): boolean {
  return actor.userId === quote.ownerId
}

/** Role rule for editing, before the lock is considered. */
function roleMayEdit(actor: Actor, quote: QuoteFacts): boolean {
  if (actor.role === "admin" || isOwner(actor, quote)) return true
  return actor.role === "manager" && quote.ownerRole === "member"
}

function canEdit(actor: Actor, quote: QuoteFacts): Decision {
  if (!roleMayEdit(actor, quote)) {
    return deny(
      "not_allowed_to_edit",
      actor.role === "manager"
        ? "Managers can edit only their own Quotes and Quotes owned by Members."
        : "You can edit only your own Quotes."
    )
  }
  if (isLocked(quote.stage)) {
    return deny("locked", "This Quote is locked in its current Stage.")
  }
  return ALLOW
}

function canDelete(
  actor: Actor,
  quote: QuoteFacts,
  settings: PolicySettings | undefined
): Decision {
  if (actor.role !== "admin" && !isOwner(actor, quote)) {
    return deny(
      "owner_or_admin_only",
      "Only the Quote Owner or an Admin can delete this Quote."
    )
  }
  const { accepted } = checkDeletableStages(
    settings?.deletableStages ?? DEFAULT_DELETABLE_STAGES
  )
  if (!accepted.includes(quote.stage)) {
    return deny("stage_not_deletable", "Quotes can't be deleted in this Stage.")
  }
  return ALLOW
}

function canSubmitQuote(actor: Actor, quote: QuoteFacts): Decision {
  if (!isOwner(actor, quote)) {
    return deny("owner_only", "Only the Quote Owner can submit this Quote.")
  }
  const check = canSubmit({ stage: quote.stage, total: quote.total })
  return check.ok ? ALLOW : deny(check.reason, check.message)
}

function canDecide(
  actor: Actor,
  quote: QuoteFacts,
  action: "approve" | "reject"
): Decision {
  if (!actor.isApprover) {
    return deny("approver_only", "Only an Approver can approve or reject.")
  }
  if (isOwner(actor, quote)) {
    return deny("self_approval", "You can't approve or reject your own Quote.")
  }
  return requireTransition(quote, action)
}

function ownerOrAdminFrom(
  actor: Actor,
  quote: QuoteFacts,
  action: ApprovalStepAction
): Decision {
  if (actor.role !== "admin" && !isOwner(actor, quote)) {
    return deny(
      "owner_or_admin_only",
      "Only the Quote Owner or an Admin can do this."
    )
  }
  return requireTransition(quote, action)
}

function requireTransition(
  quote: QuoteFacts,
  action: ApprovalStepAction
): Decision {
  return nextStage(quote.stage, action) === null
    ? deny("wrong_stage", "This isn't possible in the Quote's current Stage.")
    : ALLOW
}

/** What the viewer may do to one Quote, for showing and hiding actions. */
export interface QuotePermissions {
  canEdit: boolean
  canDelete: boolean
  canSubmit: boolean
  canApprove: boolean
  canReject: boolean
  canRecall: boolean
  canMarkSent: boolean
  canRecordCustomerOutcome: boolean
  /**
   * Why the Quote can't be edited (`locked`, or the Role rule), or `null`
   * when it can. The editor shows it as the read-only notice.
   */
  editDenial: { reason: DenialReason; message: string } | null
  /**
   * Why the viewer can't submit the Quote, or `null` when they can. The
   * header shows a disabled Submit with this message when only the Quote's
   * state stands in the way (`total_zero`, `total_negative`, …) for its Owner.
   */
  submitDenial: { reason: DenialReason; message: string } | null
}

/**
 * Every Quote action's decision for `actor` at once (`can` per action). The
 * API computes it for `quote.byId`; each command still re-checks `can`.
 */
export function quotePermissions(
  actor: Actor,
  quote: QuoteFacts,
  settings?: PolicySettings
): QuotePermissions {
  const allowed = (action: QuoteAction) =>
    can(actor, action, quote, settings).allowed
  const edit = can(actor, "quote.edit", quote)
  const submit = can(actor, "quote.submit", quote)
  return {
    canEdit: edit.allowed,
    canDelete: allowed("quote.delete"),
    canSubmit: submit.allowed,
    canApprove: allowed("quote.approve"),
    canReject: allowed("quote.reject"),
    canRecall: allowed("quote.recall"),
    canMarkSent: allowed("quote.markSent"),
    canRecordCustomerOutcome: allowed("quote.recordCustomerOutcome"),
    editDenial: edit.allowed
      ? null
      : { reason: edit.reason, message: edit.message },
    submitDenial: submit.allowed
      ? null
      : { reason: submit.reason, message: submit.message },
  }
}
