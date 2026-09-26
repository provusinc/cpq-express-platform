import { describe, expect, it } from "vitest"

import { phaseTints } from "./phase-tints"

describe("phaseTints", () => {
  it("tints top-level Phases in order and sub-Phases like their ancestor", () => {
    const tints = phaseTints([
      { id: "b", parentId: null, sequence: 1 },
      { id: "a", parentId: null, sequence: 0 },
      { id: "a1", parentId: "a", sequence: 0 },
      { id: "a11", parentId: "a1", sequence: 0 },
      { id: "b1", parentId: "b", sequence: 0 },
    ])
    expect(Object.fromEntries(tints)).toEqual({
      a: 1,
      a1: 1,
      a11: 1,
      b: 2,
      b1: 2,
    })
  })

  it("cycles after five", () => {
    const phases = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`,
      parentId: null,
      sequence: i,
    }))
    expect(phaseTints(phases).get("p5")).toBe(1)
  })
})
