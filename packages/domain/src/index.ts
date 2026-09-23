/**
 * @workspace/domain — pure CPQ Express business rules (no I/O).
 *
 * Each area is a folder under src/, importable as `@workspace/domain/<area>`;
 * this root re-exports all of them. See "Domain package API" in AGENTS.md.
 * - enums:   closed vocabularies (roles, statuses, time periods, …)
 * - money:   decimal arithmetic, currency minor units, storage strings
 * - pricing: line totals, Subtotal, Quote Discount, Total, Margin
 * - status:  Quote Status machine, locked statuses, Submission checks
 * - policy:  permission policy (`can`)
 */
export * from "./enums"
export * from "./money"
export * from "./pricing"
export * from "./status"
export * from "./policy"
