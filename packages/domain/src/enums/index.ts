/**
 * The domain's closed vocabularies, as `const` arrays plus their union types.
 * `db` builds its Postgres enums / check constraints from these and `api`
 * builds its zod enums from them (`z.enum(QUOTE_STATUSES)`), so every layer
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

/** Where a Quote stands in its lifecycle. */
export const QUOTE_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "pending_customer_approval",
  "customer_approved",
  "customer_rejected",
] as const
export type QuoteStatus = (typeof QUOTE_STATUSES)[number]

/**
 * One recorded lifecycle action (an Approval Step). Each is also the event that
 * drives the Quote Status machine (`@workspace/domain/status`).
 */
export const APPROVAL_STEP_ACTIONS = [
  "submit",
  "approve",
  "reject",
  "recall",
  "mark_sent",
  "customer_approved",
  "customer_rejected",
] as const
export type ApprovalStepAction = (typeof APPROVAL_STEP_ACTIONS)[number]

/** A Quote's planning granularity. */
export const TIME_PERIODS = ["days", "weeks", "months", "quarters"] as const
export type TimePeriod = (typeof TIME_PERIODS)[number]

/** The bucket an Allocation covers. Days and Weeks both plan by week. */
export const PERIOD_TYPES = ["week", "month", "quarter"] as const
export type PeriodType = (typeof PERIOD_TYPES)[number]

/** How a sellable's quantity is counted. */
export const BILLING_UNITS = ["each", "hour"] as const
export type BillingUnit = (typeof BILLING_UNITS)[number]

/** What a Line Item was added from. Only `resource_role` lines have Allocations. */
export const SOURCE_KINDS = ["product", "add_on", "resource_role"] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

/** Catalog Item kinds (a Resource Role is not a Catalog Item). */
export const CATALOG_ITEM_KINDS = ["product", "add_on"] as const
export type CatalogItemKind = (typeof CATALOG_ITEM_KINDS)[number]

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
