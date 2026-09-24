import { sumDecimals, toMoneyString } from "@workspace/domain/money"

import type { QuoteDocumentSnapshot } from "./snapshot"

type Line = QuoteDocumentSnapshot["lines"][number]
type Phase = QuoteDocumentSnapshot["phases"][number]

/** A Phase on the document with its own lines, nested Phases and subtotal. */
export interface PhaseGroup {
  phase: { id: string; name: string }
  /** 0 for a top-level Phase. */
  depth: number
  lines: Line[]
  children: PhaseGroup[]
  /** Σ line totals of the Phase and its descendants (money string). */
  subtotal: string
}

export interface LineGroups {
  /** Top-level Phases in order; Phases without any line are left out. */
  phases: PhaseGroup[]
  /** Lines outside every Phase, in grid order. */
  unphased: Line[]
}

const bySequence = (a: Phase, b: Phase) =>
  a.sequence - b.sequence || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * Groups the snapshot's lines by Phase (the tree, in sequence order). Lines
 * keep their grid order within a Phase; a line whose Phase isn't in the
 * snapshot counts as unphased.
 */
export function groupLinesByPhase(
  phases: readonly Phase[],
  lines: readonly Line[]
): LineGroups {
  const known = new Set(phases.map((p) => p.id))
  const linesByPhase = new Map<string, Line[]>()
  const unphased: Line[] = []
  for (const line of lines) {
    if (line.phaseId && known.has(line.phaseId)) {
      const list = linesByPhase.get(line.phaseId) ?? []
      list.push(line)
      linesByPhase.set(line.phaseId, list)
    } else {
      unphased.push(line)
    }
  }
  const childrenOf = new Map<string | null, Phase[]>()
  for (const phase of phases) {
    const parent =
      phase.parentId && known.has(phase.parentId) ? phase.parentId : null
    const list = childrenOf.get(parent) ?? []
    list.push(phase)
    childrenOf.set(parent, list)
  }

  const build = (parent: string | null, depth: number): PhaseGroup[] =>
    (childrenOf.get(parent) ?? [])
      .sort(bySequence)
      .map((phase) => {
        const own = linesByPhase.get(phase.id) ?? []
        const children = depth < 8 ? build(phase.id, depth + 1) : []
        return {
          phase: { id: phase.id, name: phase.name },
          depth,
          lines: own,
          children,
          subtotal: toMoneyString(
            sumDecimals([
              ...own.map((l) => l.lineTotal),
              ...children.map((c) => c.subtotal),
            ])
          ),
        }
      })
      .filter((group) => group.lines.length > 0 || group.children.length > 0)

  return { phases: build(null, 0), unphased }
}
