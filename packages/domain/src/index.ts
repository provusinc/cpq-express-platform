/**
 * @workspace/domain — pure CPQ Express business rules (no I/O).
 *
 * Each area is a folder under src/, importable as `@workspace/domain/<area>`;
 * this root re-exports all of them. See "Domain package API" in AGENTS.md.
 * - enums:   closed vocabularies (roles, Quote Stages, time periods, …)
 * - money:   decimal arithmetic, currency minor units, storage strings
 * - pricing: line totals, Subtotal, Quote Discount, Total, Margin
 * - stages:  Quote Stage machine, locks, Rejected, Submission checks, default Quote Statuses
 * - policy:  permission policy (`can`)
 * - dates:   ISO date-only helpers, Allocation buckets, working days
 * - effort:  largest-remainder whole-unit distribution
 * - allocations: planner cells, caps, default layout, effort resize, diff
 * - schedule: Quote date change (shift / clamp), Line Item start change
 * - phases:  Phase tree rules (depth ≤ 3, no cycles), grid order, rollups
 * - milestones: Milestone colours and limits
 * - organizations: slug rules (format, reserved), currency codes
 * - members: Membership rules (the last-Admin guard)
 * - settings: Organization settings (Hours Per Day, Label Overrides, logo)
 * - quotes:  Quote naming (the suggested Name for a new Quote)
 * - documents: Quote Document settings (validation, defaults) and deletion
 * - financials: revenue / cost / headcount buckets, item-type breakdown
 * - insights: Key Insight definitions and severity thresholds
 * - dashboard: Dashboard rules (open Stages, the Quote value chart's ranges)
 */
export * from "./enums"
export * from "./money"
export * from "./pricing"
export * from "./stages"
export * from "./policy"
export * from "./dates"
export * from "./effort"
export * from "./allocations"
export * from "./schedule"
export * from "./phases"
export * from "./milestones"
export * from "./organizations"
export * from "./members"
export * from "./settings"
export * from "./quotes"
export * from "./documents"
export * from "./financials"
export * from "./insights"
export * from "./dashboard"
