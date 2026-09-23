/**
 * @workspace/domain — pure CPQ Express business rules (no I/O).
 *
 * Areas (each a folder under src/, importable as `@workspace/domain/<area>`):
 * - money:   decimal arithmetic and rounding (ADR-0002)
 * - pricing: line totals, Subtotal, Quote Discount, Total, Margin
 * - dates:   Quote date clamp / Quote Shift, allocation buckets
 *
 * Later: status machine, permission policy, phase-tree rules.
 */
export * from "./money"
