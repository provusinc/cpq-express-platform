/**
 * Phase tree rules. Phases nest up to three levels (a top-level Phase is
 * depth 1) and the parent links must form a tree: no cycles, no unknown
 * parents. The API checks `canPlacePhase` on create and move, and
 * `validatePhaseTree` guards whole-tree writes (e.g. Clone).
 */

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
