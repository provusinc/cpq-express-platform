/**
 * Phase tints: every top-level Phase takes the next of the `phase-1..5`
 * tokens by its order (as on the Overview's Phase bar and the Planner's
 * band row), and every sub-Phase its top-level ancestor's, so a Phase's
 * rows read as one colour wherever it is shown.
 */
import { PHASE_TINTS } from "./phase-timeline"

interface PhaseLike {
  id: string
  parentId: string | null
  sequence: number
}

/** Each Phase's tint, 1 … `PHASE_TINTS`, by its top-level ancestor. */
export function phaseTints(
  phases: readonly PhaseLike[]
): ReadonlyMap<string, number> {
  const byId = new Map(phases.map((p) => [p.id, p]))
  const topTint = new Map(
    phases
      .filter((p) => p.parentId === null)
      .sort((a, b) => a.sequence - b.sequence || (a.id < b.id ? -1 : 1))
      .map((p, index) => [p.id, (index % PHASE_TINTS) + 1])
  )
  const tints = new Map<string, number>()
  for (const phase of phases) {
    // Walk up to the top level (bounded, in case of a malformed tree).
    let top = phase
    for (let i = 0; top.parentId !== null && i < phases.length; i++) {
      const parent = byId.get(top.parentId)
      if (!parent) break
      top = parent
    }
    const tint = topTint.get(top.id)
    if (tint !== undefined) tints.set(phase.id, tint)
  }
  return tints
}
