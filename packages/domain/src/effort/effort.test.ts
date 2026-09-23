import { describe, expect, it } from "vitest"

import { distributeWholeUnits } from "./index"

const n = (values: string[]) => values.map(Number)
const sum = (values: string[]) => n(values).reduce((a, b) => a + b, 0)

// Ported from portal effort-distribution.test.ts (distributeHoursByWeights).
describe("distributeWholeUnits", () => {
  it.each([
    ["a clean ramp", 160, [1, 2, 3, 4], [16, 32, 48, 64]],
    ["the old 26.7 / 53.3 / 80 bug case", 160, [1, 2, 3], [27, 53, 80]],
    ["an even split, leftover to the first", 100, [1, 1, 1], [34, 33, 33]],
    ["capacity weights", 40, [3, 2], [24, 16]],
    ["a zero total", 0, [1, 2, 3], [0, 0, 0]],
    ["a negative total", -5, [1, 1], [0, 0]],
    ["a fractional total, rounded half-up", "26.5", [1], [27]],
    ["all-zero weights split evenly", 10, [0, 0, 0], [4, 3, 3]],
    ["a zero weight gets nothing", 10, [1, 0, 1], [5, 0, 5]],
    [
      "decimal weights (ties go to the earlier share)",
      10,
      ["0.5", "1.5"],
      [3, 7],
    ],
    ["no shares", 10, [], []],
  ] as const)("%s", (_name, total, weights, expected) => {
    const shares = distributeWholeUnits(total, weights)
    expect(n(shares)).toEqual(expected)
  })

  it("keeps every share whole and preserves the total exactly", () => {
    const weights = [3, 5, 5, 5, 5, 2, 7, 1]
    for (const total of [1, 7, 33, 160, 999, 1234]) {
      const shares = distributeWholeUnits(total, weights)
      expect(sum(shares)).toBe(total)
      expect(n(shares).every(Number.isInteger)).toBe(true)
    }
  })

  it("returns quantity-scale strings", () => {
    expect(distributeWholeUnits(80, [1, 1])).toEqual(["40.000", "40.000"])
  })
})
