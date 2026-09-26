/**
 * The domain's closed vocabularies, as `const` arrays plus their union types.
 * `db` builds its Postgres enums / check constraints from these and `api`
 * builds its zod enums from them (`z.enum(QUOTE_STAGES)`), so every layer
 * spells a value the same way. Values are the stored spelling (snake_case).
 */

/** A Membership's Role within its Organization. */
export const ROLES = ["admin", "manager", "member"] as const
export type Role = (typeof ROLES)[number]

/** How a Role is written in UI copy and emails. */
export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  member: "Member",
}

/**
 * The fixed Quote Stages (glossary: Quote Stage, ADR-0004), in lifecycle
 * order. They alone carry behaviour (locking, approval, Mark as Sent, …);
 * an Organization's Quote Statuses are labels inside them. Never renamed or
 * extended.
 */
export const QUOTE_STAGES = [
  "draft",
  "in_approval",
  "approved",
  "with_customer",
  "won",
  "lost",
] as const
export type QuoteStage = (typeof QUOTE_STAGES)[number]

/** How a Quote Stage is written in UI copy. */
export const QUOTE_STAGE_LABELS: Record<QuoteStage, string> = {
  draft: "Draft",
  in_approval: "In Approval",
  approved: "Approved",
  with_customer: "With Customer",
  won: "Won",
  lost: "Lost",
}

/**
 * One recorded lifecycle action (an Approval Step). Each but `status_change`
 * is also an event that drives the Quote Stage machine
 * (`@workspace/domain/stages`); `status_change` moves a Quote between the
 * Quote Statuses of its current Stage and never changes the Stage.
 */
export const APPROVAL_STEP_ACTIONS = [
  "submit",
  "approve",
  "reject",
  "recall",
  "mark_sent",
  "customer_approved",
  "customer_rejected",
  "mark_lost",
  "reopen",
  "status_change",
] as const
export type ApprovalStepAction = (typeof APPROVAL_STEP_ACTIONS)[number]

/** A Quote's planning granularity. */
export const TIME_PERIODS = ["days", "weeks", "months", "quarters"] as const
export type TimePeriod = (typeof TIME_PERIODS)[number]

/** How a Time Period is written in UI copy. */
export const TIME_PERIOD_LABELS: Record<TimePeriod, string> = {
  days: "Days",
  weeks: "Weeks",
  months: "Months",
  quarters: "Quarters",
}

/** The bucket an Allocation covers. Days and Weeks both plan by week. */
export const PERIOD_TYPES = ["week", "month", "quarter"] as const
export type PeriodType = (typeof PERIOD_TYPES)[number]

/** How a sellable's quantity is counted. */
export const BILLING_UNITS = ["each", "hour"] as const
export type BillingUnit = (typeof BILLING_UNITS)[number]

/**
 * What a Line Item was added from: a Catalog Item (whose Catalog Type is
 * Organization data, reached through the item) or a Resource Role. Only
 * `resource_role` lines have Allocations.
 */
export const SOURCE_KINDS = ["catalog_item", "resource_role"] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

/** How the Quote Discount was entered; the entered one stays authoritative. */
export const DISCOUNT_KINDS = ["percent", "amount"] as const
export type DiscountKind = (typeof DISCOUNT_KINDS)[number]

/** Milestone types. */
export const MILESTONE_TYPES = [
  "milestone",
  "deadline",
  "review",
  "payment_due",
  "custom",
] as const
export type MilestoneType = (typeof MILESTONE_TYPES)[number]

/** Milestone type names for UI copy. */
export const MILESTONE_TYPE_LABELS: Record<MilestoneType, string> = {
  milestone: "Milestone",
  deadline: "Deadline",
  review: "Review",
  payment_due: "Payment due",
  custom: "Custom",
}

/**
 * The Organization-managed value lists that classify a Customer (glossary:
 * Customer Type / Industry). One table holds both, told apart by this kind.
 */
export const CUSTOMER_CLASSIFICATION_KINDS = [
  "customer_type",
  "industry",
] as const
export type CustomerClassificationKind =
  (typeof CUSTOMER_CLASSIFICATION_KINDS)[number]

/** Each list's names for UI copy. */
export const CUSTOMER_CLASSIFICATION_KIND_LABELS: Record<
  CustomerClassificationKind,
  { singular: string; plural: string }
> = {
  customer_type: { singular: "Customer Type", plural: "Customer Types" },
  industry: { singular: "Industry", plural: "Industries" },
}

/**
 * Domain terms an Organization may rename with a Label Override. Code and API
 * always use these canonical terms; only UI copy changes. Catalog Types are
 * named directly and take none.
 */
export const LABEL_TERMS = ["resource_role", "phase"] as const
export type LabelTerm = (typeof LABEL_TERMS)[number]
