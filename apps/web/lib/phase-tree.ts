/**
 * Client-side Phase tree helpers for the Line Items grid and the Timeline:
 * the rows to show (grid order from the domain's `phaseTreeOrder`, minus
 * the contents of collapsed Phases), the Phase picker options, and the
 * optimistic versions of the move commands (the same `placeBefore` rule
 * the API applies, so the grid doesn't jump when the server answers).
 */
import {
  phaseSubtree,
  phaseTreeOrder,
  placeBefore,
} from "@workspace/domain/phases"
import type { TreeRow } from "@workspace/domain/phases"

interface PhaseLike {
  id: string
  parentId: string | null
  name: string
  sequence: number
}

interface LineLike {
  id: string
  phaseId: string | null
  sequence: number
}

/** Grid rows in order, skipping everything inside a collapsed Phase. */
export function visibleTreeRows(
  phases: readonly PhaseLike[],
  lines: readonly LineLike[],
  collapsed: ReadonlySet<string>
): TreeRow[] {
  const rows = phaseTreeOrder(phases, lines)
  const hidden = new Set<string>()
  for (const id of collapsed) {
    for (const inner of phaseSubtree(phases, id).slice(1)) hidden.add(inner)
  }
  return rows.filter((row) => {
    if (row.kind === "phase") return !hidden.has(row.id)
    return (
      row.phaseId === null ||
      (!hidden.has(row.phaseId) && !collapsed.has(row.phaseId))
    )
  })
}

export interface PhaseOption {
  value: string
  /** The name, indented by depth for a flat select. */
  label: string
  depth: number
}

/** Every Phase in tree order, for pickers ("Add to", "Move to"). */
export function phaseOptions(phases: readonly PhaseLike[]): PhaseOption[] {
  const byId = new Map(phases.map((p) => [p.id, p]))
  return phaseTreeOrder(phases, [])
    .filter((row) => row.kind === "phase")
    .map((row) => ({
      value: row.id,
      label: `${" ".repeat(row.depth - 1)}${byId.get(row.id)!.name}`,
      depth: row.depth,
    }))
}

/** `lines` after `lineItem.move({ ids, phaseId, beforeId })`, or unchanged if refused. */
export function moveLinesLocally<T extends LineLike>(
  phases: readonly PhaseLike[],
  lines: readonly T[],
  {
    ids,
    phaseId,
    beforeId,
  }: {
    ids: readonly string[]
    phaseId: string | null
    beforeId?: string | null
  }
): T[] {
  const moving = new Set(ids)
  const ordered = phaseTreeOrder(phases, lines)
    .filter((row) => row.kind === "line" && moving.has(row.id))
    .map((row) => row.id)
  const target = [...lines]
    .filter((l) => l.phaseId === phaseId)
    .sort((a, b) => a.sequence - b.sequence || (a.id < b.id ? -1 : 1))
    .map((l) => l.id)
  const order = placeBefore(target, ordered, beforeId ?? null)
  if (!order) return [...lines]
  const position = new Map(order.map((id, i) => [id, i]))
  return lines.map((line) =>
    position.has(line.id)
      ? { ...line, phaseId, sequence: position.get(line.id)! }
      : line
  )
}

/** `phases` after `phase.move({ id, parentId, beforeId })`, or unchanged if refused. */
export function movePhaseLocally<T extends PhaseLike>(
  phases: readonly T[],
  {
    id,
    parentId,
    beforeId,
  }: { id: string; parentId: string | null; beforeId?: string | null }
): T[] {
  const siblings = [...phases]
    .filter((p) => p.parentId === parentId)
    .sort((a, b) => a.sequence - b.sequence || (a.id < b.id ? -1 : 1))
    .map((p) => p.id)
  const order = placeBefore(siblings, [id], beforeId ?? null)
  if (!order) return [...phases]
  const position = new Map(order.map((pid, i) => [pid, i]))
  return phases.map((phase) =>
    position.has(phase.id)
      ? { ...phase, parentId, sequence: position.get(phase.id)! }
      : phase
  )
}

/** What is dragged: Line Items (by one of them) or a Phase. */
export type DragSource =
  | { kind: "line"; id: string }
  | { kind: "phase"; id: string }

/** Where it is dropped: onto a line, onto a Phase row, or the end zone (top level). */
export type DropTarget =
  | { kind: "line"; id: string }
  | { kind: "phase"; id: string }
  | { kind: "end" }

/** The one command a drop means, or null when it means nothing. */
export type DropCommand =
  | {
      kind: "lines"
      ids: string[]
      phaseId: string | null
      beforeId: string | null
      /** Dropped onto a Phase row: the lines go into it (at its start). */
      into: boolean
    }
  | {
      kind: "phase"
      id: string
      parentId: string | null
      beforeId: string | null
    }

/**
 * Drop semantics of the grid ("before the row you drop on"):
 * - Line Items onto a line → before it, in its Phase; onto a Phase row →
 *   into that Phase at its start; onto the end zone → outside every Phase,
 *   at the end. Dragging a selected line moves the whole selection (in
 *   grid order), else just that line.
 * - A Phase onto a Phase row → before it, as its sibling; onto a line → at
 *   the end of that line's Phase (or the top level); onto the end zone → at
 *   the end of the top level. Dropping into itself means nothing (the
 *   depth limit is the caller's check, with `canPlacePhase`).
 */
export function resolveDrop(
  phases: readonly PhaseLike[],
  lines: readonly LineLike[],
  source: DragSource,
  target: DropTarget,
  selectedLineIds: readonly string[] = []
): DropCommand | null {
  const lineById = new Map(lines.map((l) => [l.id, l]))
  if (source.kind === "line") {
    const ids = selectedLineIds.includes(source.id)
      ? phaseTreeOrder(phases, lines)
          .filter((r) => r.kind === "line" && selectedLineIds.includes(r.id))
          .map((r) => r.id)
      : [source.id]
    if (target.kind === "end") {
      return { kind: "lines", ids, phaseId: null, beforeId: null, into: false }
    }
    if (target.kind === "line") {
      const over = lineById.get(target.id)
      if (!over || ids.includes(over.id)) return null
      return {
        kind: "lines",
        ids,
        phaseId: over.phaseId,
        beforeId: over.id,
        into: false,
      }
    }
    const first = phaseTreeOrder(phases, lines).find(
      (r) => r.kind === "line" && r.phaseId === target.id && !ids.includes(r.id)
    )
    return {
      kind: "lines",
      ids,
      phaseId: target.id,
      beforeId: first?.id ?? null,
      into: true,
    }
  }

  const inside = new Set(phaseSubtree(phases, source.id))
  if (target.kind === "end") {
    return { kind: "phase", id: source.id, parentId: null, beforeId: null }
  }
  if (target.kind === "phase") {
    const over = phases.find((p) => p.id === target.id)
    if (!over || inside.has(over.id)) return null
    return {
      kind: "phase",
      id: source.id,
      parentId: over.parentId,
      beforeId: over.id,
    }
  }
  const over = lineById.get(target.id)
  if (!over || (over.phaseId !== null && inside.has(over.phaseId))) return null
  return {
    kind: "phase",
    id: source.id,
    parentId: over.phaseId,
    beforeId: null,
  }
}

/** The Phase and its descendants' ids (what a Phase delete removes). */
export function subtreeIds(
  phases: readonly PhaseLike[],
  phaseId: string
): Set<string> {
  return new Set(phaseSubtree(phases, phaseId))
}
