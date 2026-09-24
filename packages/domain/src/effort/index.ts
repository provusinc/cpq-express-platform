import { Decimal } from "decimal.js"

import { type DecimalInput, toQuantityString } from "../money"

/**
 * Effort distribution: the one place that owns the whole-units invariant.
 * A distribution that splits a total keeps every share a whole number of
 * hours (or units) and preserves the total exactly, using the largest-remainder
 * method: floor every ideal share, then hand the leftover units to the shares
 * with the largest fractional parts (earlier shares win ties).
 */

/**
 * Split `total` (rounded half-up to a whole number, negatives as 0) across
 * shares in proportion to `weights`. Returns whole-number strings at quantity
 * scale ("27.000") that sum exactly to the rounded total. When every weight is
 * zero the split is even.
 */
export function distributeWholeUnits(
  total: DecimalInput,
  weights: readonly DecimalInput[]
): string[] {
  if (weights.length === 0) return []
  const target = Decimal.max(
    0,
    new Decimal(total).toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
  )
  let ws = weights.map((w) => Decimal.max(0, new Decimal(w)))
  let weightSum = ws.reduce((a, b) => a.plus(b), new Decimal(0))
  if (weightSum.isZero()) {
    ws = ws.map(() => new Decimal(1))
    weightSum = new Decimal(ws.length)
  }

  const ideal = ws.map((w) => target.times(w).dividedBy(weightSum))
  const shares = ideal.map((v) => v.floor())
  let leftover = target
    .minus(shares.reduce((a, b) => a.plus(b), new Decimal(0)))
    .toNumber()

  const byFraction = ideal
    .map((v, index) => ({ index, fraction: v.minus(v.floor()) }))
    .sort((a, b) => b.fraction.comparedTo(a.fraction) || a.index - b.index)
  for (let k = 0; leftover > 0 && k < byFraction.length; k++, leftover--) {
    const { index } = byFraction[k]!
    shares[index] = shares[index]!.plus(1)
  }
  return shares.map(toQuantityString)
}
