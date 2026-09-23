import { describe, expect, it } from "vitest"

import {
  canPlacePhase,
  type PhaseNode,
  phaseDepth,
  phaseSubtree,
  validatePhaseTree,
} from "./index"

const p = (id: string, parentId: string | null = null): PhaseNode => ({
  id,
  parentId,
})

// Discovery ─┬─ Workshops ── Day 1
//            └─ Interviews
// Build
const tree = [
  p("discovery"),
  p("workshops", "discovery"),
  p("day1", "workshops"),
  p("interviews", "discovery"),
  p("build"),
]

describe("validatePhaseTree", () => {
  it("accepts an empty tree and a three-level tree", () => {
    expect(validatePhaseTree([])).toEqual({ ok: true })
    expect(validatePhaseTree(tree)).toEqual({ ok: true })
  })

  it.each([
    ["a fourth level", [...tree, p("hour1", "day1")], [["hour1", "too_deep"]]],
    ["a self-parent", [p("a", "a")], [["a", "cycle"]]],
    [
      "a two-Phase cycle",
      [p("a", "b"), p("b", "a")],
      [
        ["a", "cycle"],
        ["b", "cycle"],
      ],
    ],
    ["an unknown parent", [p("a", "ghost")], [["a", "unknown_parent"]]],
    ["a duplicate id", [p("a"), p("a")], [["a", "duplicate_id"]]],
  ] as const)("reports %s", (_name, phases, expected) => {
    expect(validatePhaseTree(phases)).toEqual({
      ok: false,
      problems: expected.map(([phaseId, problem]) => ({ phaseId, problem })),
    })
  })
})

describe("phaseDepth / phaseSubtree", () => {
  it.each([
    ["discovery", 1],
    ["workshops", 2],
    ["day1", 3],
    ["build", 1],
  ])("%s is at depth %i", (id, depth) => {
    expect(phaseDepth(tree, id)).toBe(depth)
  })

  it("throws for a broken chain", () => {
    expect(() => phaseDepth([p("a", "a")], "a")).toThrow(RangeError)
  })

  it("lists a Phase and its descendants, root first", () => {
    expect(phaseSubtree(tree, "discovery")).toEqual([
      "discovery",
      "workshops",
      "interviews",
      "day1",
    ])
    expect(phaseSubtree(tree, "build")).toEqual(["build"])
  })
})

describe("canPlacePhase", () => {
  it.each([
    ["create at the top level", undefined, null, true],
    ["create under a depth-2 Phase", undefined, "workshops", true],
    ["create under a depth-3 Phase", undefined, "day1", "too_deep"],
    ["create under an unknown parent", undefined, "ghost", "unknown_parent"],
    ["move a leaf to the top level", "day1", null, true],
    ["move a leaf under a depth-2 Phase", "build", "interviews", true],
    [
      "move a two-level subtree under a depth-2 Phase",
      "workshops",
      "interviews",
      "too_deep",
    ],
    [
      "move a two-level subtree under a top-level Phase",
      "workshops",
      "build",
      true,
    ],
    [
      "move a three-level subtree under a top-level Phase",
      "discovery",
      "build",
      "too_deep",
    ],
    [
      "move a Phase inside its own descendant",
      "discovery",
      "day1",
      "into_itself",
    ],
    ["move a Phase under itself", "build", "build", "into_itself"],
    ["move an unknown Phase", "ghost", null, "unknown_phase"],
  ] as const)("%s", (_name, phaseId, parentId, expected) => {
    const result = canPlacePhase(tree, { phaseId, parentId })
    if (expected === true) expect(result).toEqual({ ok: true })
    else expect(result).toMatchObject({ ok: false, reason: expected })
  })
})
