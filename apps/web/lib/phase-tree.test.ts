import { describe, expect, it } from "vitest"

import {
  moveLinesLocally,
  movePhaseLocally,
  phaseOptions,
  resolveDrop,
  visibleTreeRows,
} from "./phase-tree"

const phases = [
  { id: "a", parentId: null, name: "A", sequence: 0 },
  { id: "a1", parentId: "a", name: "A1", sequence: 0 },
  { id: "b", parentId: null, name: "B", sequence: 1 },
]
const lines = [
  { id: "r", phaseId: null, sequence: 0 },
  { id: "x", phaseId: "a", sequence: 1 },
  { id: "y", phaseId: "a1", sequence: 2 },
  { id: "z", phaseId: "b", sequence: 3 },
]

describe("visibleTreeRows", () => {
  it("hides the contents of collapsed Phases", () => {
    expect(
      visibleTreeRows(phases, lines, new Set(["a"])).map((r) => r.id)
    ).toEqual(["r", "a", "b", "z"])
    expect(visibleTreeRows(phases, lines, new Set()).map((r) => r.id)).toEqual([
      "r",
      "a",
      "x",
      "a1",
      "y",
      "b",
      "z",
    ])
  })
})

describe("phaseOptions", () => {
  it("lists Phases in tree order, indented", () => {
    expect(phaseOptions(phases)).toEqual([
      { value: "a", label: "A", depth: 1 },
      { value: "a1", label: " A1", depth: 2 },
      { value: "b", label: "B", depth: 1 },
    ])
  })
})

describe("moveLinesLocally", () => {
  it("moves lines into a Phase before a line, renumbering it", () => {
    const moved = moveLinesLocally(phases, lines, {
      ids: ["y", "r"],
      phaseId: "b",
      beforeId: "z",
    })
    expect(
      moved
        .filter((l) => l.phaseId === "b")
        .sort((p, q) => p.sequence - q.sequence)
        .map((l) => l.id)
    ).toEqual(["r", "y", "z"])
  })

  it("leaves lines alone for an impossible beforeId", () => {
    expect(
      moveLinesLocally(phases, lines, {
        ids: ["r"],
        phaseId: "b",
        beforeId: "x",
      })
    ).toEqual(lines)
  })
})

describe("resolveDrop", () => {
  it.each([
    [
      "a line onto a line",
      { kind: "line", id: "r" },
      { kind: "line", id: "z" },
      [],
      { kind: "lines", ids: ["r"], phaseId: "b", beforeId: "z", into: false },
    ],
    [
      "the selection onto a Phase row (in grid order, at its start)",
      { kind: "line", id: "z" },
      { kind: "phase", id: "a" },
      ["z", "r"],
      {
        kind: "lines",
        ids: ["r", "z"],
        phaseId: "a",
        beforeId: "x",
        into: true,
      },
    ],
    [
      "a line onto the end zone",
      { kind: "line", id: "x" },
      { kind: "end" },
      [],
      { kind: "lines", ids: ["x"], phaseId: null, beforeId: null, into: false },
    ],
    [
      "a Phase onto a Phase row",
      { kind: "phase", id: "b" },
      { kind: "phase", id: "a1" },
      [],
      { kind: "phase", id: "b", parentId: "a", beforeId: "a1" },
    ],
    [
      "a Phase onto a line",
      { kind: "phase", id: "b" },
      { kind: "line", id: "x" },
      [],
      { kind: "phase", id: "b", parentId: "a", beforeId: null },
    ],
    [
      "a Phase into its own subtree",
      { kind: "phase", id: "a" },
      { kind: "line", id: "y" },
      [],
      null,
    ],
    [
      "a line onto itself",
      { kind: "line", id: "x" },
      { kind: "line", id: "x" },
      [],
      null,
    ],
  ] as const)("resolves %s", (_, source, target, selected, expected) => {
    expect(resolveDrop(phases, lines, source, target, selected)).toEqual(
      expected
    )
  })
})

describe("movePhaseLocally", () => {
  it("re-parents and reorders", () => {
    const moved = movePhaseLocally(phases, {
      id: "b",
      parentId: null,
      beforeId: "a",
    })
    expect(moved.find((p) => p.id === "b")!.sequence).toBe(0)
    expect(moved.find((p) => p.id === "a")!.sequence).toBe(1)
    const nested = movePhaseLocally(phases, { id: "b", parentId: "a" })
    expect(nested.find((p) => p.id === "b")).toMatchObject({
      parentId: "a",
      sequence: 1,
    })
  })
})
