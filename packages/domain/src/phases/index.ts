/**
 * Phase tree rules. Phases nest up to three levels (a top-level Phase is
 * depth 1) and the parent links must form a tree: no cycles, no unknown
 * parents. The API checks `canPlacePhase` on create and move, and
 * `validatePhaseTree` guards whole-tree writes (e.g. Clone).
 *
 * Grid order: inside every container (the Quote's top level or a Phase)
 * its Line Items come first, by `sequence`, then its child Phases, by
 * `sequence`, each followed by its own contents (`phaseTreeOrder`). A
 * Phase's totals and date span are derived from everything inside it
 * (`phaseRollups`), never stored. `placeBefore` is the reorder rule every
 * move uses.
 */
import { compareDates } from "../dates"
import type { IsoDate } from "../dates"
import { Decimal, toMoneyString, toPercentString } from "../money"
import type { DecimalInput } from "../money"

export const MAX_PHASE_DEPTH = 3

export interface PhaseNode {
  id: string
  /** `null` for a top-level Phase. */
  parentId: string | null
}

export type PhaseTreeProblem =
  | "unknown_parent"
  | "cycle"
  | "too_deep"
  | "duplicate_id"

export type PhaseTreeCheck =
  | { ok: true }
  | {
      ok: false
      problems: Array<{ phaseId: string; problem: PhaseTreeProblem }>
    }

/** Check a whole Phase tree: unique ids, known parents, no cycles, depth ≤ 3. */
export function validatePhaseTree(
  phases: readonly PhaseNode[]
): PhaseTreeCheck {
  const problems: Array<{ phaseId: string; problem: PhaseTreeProblem }> = []
  const byId = new Map<string, PhaseNode>()
  for (const phase of phases) {
    if (byId.has(phase.id)) {
      problems.push({ phaseId: phase.id, problem: "duplicate_id" })
    }
    byId.set(phase.id, phase)
  }
  for (const phase of byId.values()) {
    const depth = depthIn(byId, phase.id)
    if (depth === "unknown_parent" || depth === "cycle") {
      problems.push({ phaseId: phase.id, problem: depth })
    } else if (depth > MAX_PHASE_DEPTH) {
      problems.push({ phaseId: phase.id, problem: "too_deep" })
    }
  }
  return problems.length === 0 ? { ok: true } : { ok: false, problems }
}

/** 1 for a top-level Phase. Throws if the chain is broken or cyclic. */
export function phaseDepth(
  phases: readonly PhaseNode[],
  phaseId: string
): number {
  const depth = depthIn(indexById(phases), phaseId)
  if (typeof depth !== "number") {
    throw new RangeError(`Phase ${phaseId}: ${depth}`)
  }
  return depth
}

/** The Phase and all its descendants (what deleting it removes), root first. */
export function phaseSubtree(
  phases: readonly PhaseNode[],
  phaseId: string
): string[] {
  const children = childrenIndex(phases)
  const result: string[] = []
  const seen = new Set<string>()
  const queue = [phaseId]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    result.push(id)
    queue.push(...(children.get(id) ?? []))
  }
  return result
}

export type PlacementRefusal =
  | "unknown_parent"
  | "unknown_phase"
  | "into_itself"
  | "too_deep"

export type PlacementCheck =
  | { ok: true }
  | { ok: false; reason: PlacementRefusal; message: string }

/**
 * May a Phase be placed under `parentId` (`null` = top level)? Pass `phaseId`
 * to move an existing Phase (its whole subtree moves with it); omit it to
 * create a new one.
 */
export function canPlacePhase(
  phases: readonly PhaseNode[],
  placement: { phaseId?: string; parentId: string | null }
): PlacementCheck {
  const byId = indexById(phases)
  const { phaseId, parentId } = placement
  if (phaseId !== undefined && !byId.has(phaseId)) {
    return { ok: false, reason: "unknown_phase", message: "Phase not found." }
  }
  if (parentId !== null && !byId.has(parentId)) {
    return {
      ok: false,
      reason: "unknown_parent",
      message: "Parent Phase not found.",
    }
  }
  let subtreeHeight = 1
  if (phaseId !== undefined) {
    const subtree = phaseSubtree(phases, phaseId)
    if (parentId !== null && subtree.includes(parentId)) {
      return {
        ok: false,
        reason: "into_itself",
        message: "A Phase can't be moved inside itself.",
      }
    }
    const rootDepth = phaseDepth(phases, phaseId)
    subtreeHeight =
      Math.max(...subtree.map((id) => phaseDepth(phases, id))) - rootDepth + 1
  }
  const parentDepth = parentId === null ? 0 : phaseDepth(phases, parentId)
  if (parentDepth + subtreeHeight > MAX_PHASE_DEPTH) {
    return {
      ok: false,
      reason: "too_deep",
      message: `Phases can nest at most ${MAX_PHASE_DEPTH} levels deep.`,
    }
  }
  return { ok: true }
}

function indexById(phases: readonly PhaseNode[]): Map<string, PhaseNode> {
  return new Map(phases.map((p) => [p.id, p]))
}

function childrenIndex(phases: readonly PhaseNode[]): Map<string, string[]> {
  const children = new Map<string, string[]>()
  for (const phase of phases) {
    if (phase.parentId === null) continue
    const list = children.get(phase.parentId) ?? []
    list.push(phase.id)
    children.set(phase.parentId, list)
  }
  return children
}

function depthIn(
  byId: ReadonlyMap<string, PhaseNode>,
  phaseId: string
): number | "unknown_parent" | "cycle" {
  const visited = new Set<string>()
  let current = byId.get(phaseId)
  if (!current) return "unknown_parent"
  let depth = 1
  while (current.parentId !== null) {
    if (visited.has(current.id)) return "cycle"
    visited.add(current.id)
    const parent = byId.get(current.parentId)
    if (!parent) return "unknown_parent"
    current = parent
    depth++
  }
  return depth
}

/** A Phase as the grid orders it. */
export interface OrderedPhase extends PhaseNode {
  sequence: number
}

/** A Line Item as the grid orders it. */
export interface OrderedLine {
  id: string
  /** `null` (or an unknown Phase) = outside every Phase. */
  phaseId: string | null
  sequence: number
}

export type TreeRow =
  | { kind: "phase"; id: string; depth: number; parentId: string | null }
  | { kind: "line"; id: string; depth: number; phaseId: string | null }

const bySequence = (
  a: { sequence: number; id: string },
  b: { sequence: number; id: string }
) => a.sequence - b.sequence || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * Every Phase and Line Item in grid order (see the module comment), with
 * its depth: top-level rows are depth 0 for lines and 1 for Phases, and a
 * Phase's contents are one level deeper than it. Lines of an unknown Phase
 * are treated as outside every Phase; Phases whose chain is broken are
 * left out (they can't occur in a valid tree).
 */
export function phaseTreeOrder(
  phases: readonly OrderedPhase[],
  lines: readonly OrderedLine[]
): TreeRow[] {
  const known = new Set(phases.map((p) => p.id))
  const childPhases = new Map<string | null, OrderedPhase[]>()
  for (const phase of phases) {
    const list = childPhases.get(phase.parentId) ?? []
    list.push(phase)
    childPhases.set(phase.parentId, list)
  }
  const childLines = new Map<string | null, OrderedLine[]>()
  for (const line of lines) {
    const key =
      line.phaseId !== null && known.has(line.phaseId) ? line.phaseId : null
    const list = childLines.get(key) ?? []
    list.push(line)
    childLines.set(key, list)
  }
  const rows: TreeRow[] = []
  const seen = new Set<string>()
  const visit = (container: string | null, depth: number) => {
    for (const line of [...(childLines.get(container) ?? [])].sort(
      bySequence
    )) {
      rows.push({ kind: "line", id: line.id, depth, phaseId: container })
    }
    for (const phase of [...(childPhases.get(container) ?? [])].sort(
      bySequence
    )) {
      if (seen.has(phase.id)) continue
      seen.add(phase.id)
      rows.push({
        kind: "phase",
        id: phase.id,
        depth: depth + 1,
        parentId: phase.parentId,
      })
      visit(phase.id, depth + 1)
    }
  }
  visit(null, 0)
  return rows
}

/**
 * The order of a container's children after moving `moving` into it:
 * `ordered` is its current children (in order, may include some of
 * `moving`), the moved ones are inserted together, in the given order,
 * right before `beforeId`, or at the end when `beforeId` is null. Returns
 * null when `beforeId` isn't one of the children that stay.
 */
export function placeBefore(
  ordered: readonly string[],
  moving: readonly string[],
  beforeId: string | null
): string[] | null {
  const movingSet = new Set(moving)
  const staying = ordered.filter((id) => !movingSet.has(id))
  if (beforeId === null) return [...staying, ...moving]
  const at = staying.indexOf(beforeId)
  if (at < 0) return null
  return [...staying.slice(0, at), ...moving, ...staying.slice(at)]
}

/** What a Phase's derived figures are computed from. */
export interface RollupLine {
  id: string
  phaseId: string | null
  startDate: IsoDate
  endDate: IsoDate
  lineTotal: DecimalInput
  unitCost: DecimalInput
  quantity: DecimalInput
}

/** A Phase's figures, derived from everything inside it (never stored). */
export interface PhaseRollup {
  /** Descendant Phases (not counting itself). */
  phaseCount: number
  /** Line Items in it or in any descendant Phase. */
  lineCount: number
  /** Σ line totals (money string). */
  total: string
  /** Σ unit cost × quantity (money string). */
  cost: string
  /** total − cost. */
  margin: string
  /** margin / total × 100, or 0 when total is 0. */
  marginPct: string
  /** Earliest start and latest end of its lines; null when it has none. */
  startDate: IsoDate | null
  endDate: IsoDate | null
}

/**
 * Every Phase's derived totals and date span (keyed by Phase id), counting
 * the Line Items of its descendants too. What a Phase delete removes is
 * `phaseCount` sub-Phases and `lineCount` Line Items.
 */
export function phaseRollups(
  phases: readonly PhaseNode[],
  lines: readonly RollupLine[]
): Record<string, PhaseRollup> {
  const byId = indexById(phases)
  const acc = new Map<
    string,
    {
      phaseCount: number
      lineCount: number
      total: Decimal
      cost: Decimal
      startDate: IsoDate | null
      endDate: IsoDate | null
    }
  >()
  for (const phase of phases) {
    acc.set(phase.id, {
      phaseCount: 0,
      lineCount: 0,
      total: new Decimal(0),
      cost: new Decimal(0),
      startDate: null,
      endDate: null,
    })
  }
  /** The Phase and its ancestors, bottom up (stops at a broken or cyclic link). */
  const chain = (phaseId: string): string[] => {
    const ids: string[] = []
    const seen = new Set<string>()
    let current = byId.get(phaseId)
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      ids.push(current.id)
      current =
        current.parentId === null ? undefined : byId.get(current.parentId)
    }
    return ids
  }
  for (const phase of phases) {
    for (const ancestor of chain(phase.id).slice(1))
      acc.get(ancestor)!.phaseCount++
  }
  for (const line of lines) {
    if (line.phaseId === null || !byId.has(line.phaseId)) continue
    const cost = new Decimal(line.unitCost).times(line.quantity)
    for (const id of chain(line.phaseId)) {
      const a = acc.get(id)!
      a.lineCount++
      a.total = a.total.plus(line.lineTotal)
      a.cost = a.cost.plus(cost)
      a.startDate =
        a.startDate === null || compareDates(line.startDate, a.startDate) < 0
          ? line.startDate
          : a.startDate
      a.endDate =
        a.endDate === null || compareDates(line.endDate, a.endDate) > 0
          ? line.endDate
          : a.endDate
    }
  }
  const result: Record<string, PhaseRollup> = {}
  for (const [id, a] of acc) {
    const margin = a.total.minus(a.cost)
    result[id] = {
      phaseCount: a.phaseCount,
      lineCount: a.lineCount,
      total: toMoneyString(a.total),
      cost: toMoneyString(a.cost),
      margin: toMoneyString(margin),
      marginPct: toPercentString(
        a.total.isZero()
          ? 0
          : Decimal.min(
              999.9999,
              Decimal.max(-999.9999, margin.dividedBy(a.total).times(100))
            )
      ),
      startDate: a.startDate,
      endDate: a.endDate,
    }
  }
  return result
}
