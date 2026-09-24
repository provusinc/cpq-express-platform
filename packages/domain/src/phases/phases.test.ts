import { describe, expect, it } from "vitest"

import {
  canPlacePhase,
  type OrderedPhase,
  type PhaseNode,
  phaseDepth,
  phaseRollups,
  phaseSubtree,
  phaseTreeOrder,
  placeBefore,
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

describe("phaseTreeOrder", () => {
  const phase = (
    id: string,
    parentId: string | null,
    sequence: number
  ): OrderedPhase => ({ id, parentId, sequence })
  const line = (id: string, phaseId: string | null, sequence: number) => ({
    id,
    phaseId,
    sequence,
  })

  it("puts each container's lines first, then its Phases, depth-first", () => {
    const rows = phaseTreeOrder(
      [
        phase("build", null, 1),
        phase("discovery", null, 0),
        phase("workshops", "discovery", 0),
      ],
      [
        line("l-build", "build", 0),
        line("l-root2", null, 5),
        line("l-root1", null, 2),
        line("l-disc", "discovery", 3),
        line("l-work", "workshops", 0),
        line("l-orphan", "gone", 9),
      ]
    )
    expect(rows.map((r) => `${r.kind}:${r.id}@${r.depth}`)).toEqual([
      "line:l-root1@0",
      "line:l-root2@0",
      "line:l-orphan@0",
      "phase:discovery@1",
      "line:l-disc@1",
      "phase:workshops@2",
      "line:l-work@2",
      "phase:build@1",
      "line:l-build@1",
    ])
  })
})

describe("placeBefore", () => {
  it.each([
    ["at the end", ["a", "b", "c"], ["x"], null, ["a", "b", "c", "x"]],
    [
      "before a child",
      ["a", "b", "c"],
      ["x", "y"],
      "b",
      ["a", "x", "y", "b", "c"],
    ],
    ["reordering within", ["a", "b", "c"], ["c"], "a", ["c", "a", "b"]],
    ["moving down", ["a", "b", "c"], ["a"], null, ["b", "c", "a"]],
  ] as const)("inserts %s", (_, ordered, moving, beforeId, expected) => {
    expect(placeBefore(ordered, moving, beforeId)).toEqual(expected)
  })

  it("refuses an unknown or moving beforeId", () => {
    expect(placeBefore(["a"], ["x"], "zzz")).toBeNull()
    expect(placeBefore(["a", "x"], ["x"], "x")).toBeNull()
  })
})

describe("phaseRollups", () => {
  const l = (
    id: string,
    phaseId: string | null,
    startDate: string,
    endDate: string,
    lineTotal: string,
    unitCost = "0",
    quantity = "1"
  ) => ({ id, phaseId, startDate, endDate, lineTotal, unitCost, quantity })

  it("rolls totals, cost, margin, counts and dates up through ancestors", () => {
    const rollups = phaseRollups(tree, [
      l("a", "day1", "2026-10-05", "2026-10-09", "1000", "60", "10"),
      l("b", "interviews", "2026-10-01", "2026-10-02", "500.5", "100", "2"),
      l("c", null, "2026-09-01", "2026-12-31", "99999"),
    ])
    expect(rollups.discovery).toEqual({
      phaseCount: 3,
      lineCount: 2,
      total: "1500.5000",
      cost: "800.0000",
      margin: "700.5000",
      marginPct: "46.6844",
      startDate: "2026-10-01",
      endDate: "2026-10-09",
    })
    expect(rollups.workshops).toMatchObject({
      phaseCount: 1,
      lineCount: 1,
      total: "1000.0000",
      startDate: "2026-10-05",
    })
    expect(rollups.build).toEqual({
      phaseCount: 0,
      lineCount: 0,
      total: "0.0000",
      cost: "0.0000",
      margin: "0.0000",
      marginPct: "0.0000",
      startDate: null,
      endDate: null,
    })
  })
})
