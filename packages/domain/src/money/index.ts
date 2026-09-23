import { Decimal } from "decimal.js"

/**
 * The only numeric type used for money, percentages and quantities (ADR-0002).
 * Never use JS `number` arithmetic for money. Values cross the API and DB
 * boundary as strings (Postgres `numeric` → string) and are wrapped here.
 *
 * Rounding rules (minor unit, rounding mode) are defined by the pricing engine.
 */
export { Decimal }
