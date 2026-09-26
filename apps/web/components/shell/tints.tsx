"use client"

import type { SourceKind } from "@workspace/domain/enums"
import { cn } from "@workspace/ui/lib/utils"

import { useCatalogTypes } from "./catalog-types"
import type { CatalogTypeView } from "./catalog-types"
import { useLabels } from "./labels"

/**
 * The app's identifying colours, one place for every surface (the Line
 * Items grid, the Planner, the Timeline, the Overview, the Add Items
 * sheet, the sidebar), so the same thing always has the same colour:
 *
 * - an item type is its chart series (`SERIES`, the validated order):
 *   labour (Resource Roles) is slot 1, a Catalog Type slot 2 + its
 *   `colourIndex` (`catalogTypeTone`), so each of the at most 6 active
 *   types keeps a distinct colour;
 * - a Phase is its top-level Phase's tint (`phaseTints` in
 *   `lib/phase-tints.ts`).
 *
 * Tailwind only sees whole class names, so every variant is spelled out.
 */
export interface ItemTone {
  /** A small solid swatch. */
  dot: string
  /** An icon or text in the colour. */
  ink: string
  /** A bar: light fill with a stronger edge (Timeline bars, legends). */
  bar: string
  /** The raw colour, for inline styles and CSS variables. */
  colour: string
  /** A nav icon (important: the sidebar button styles its icons). */
  navIcon: string
}

/** The categorical series 1…7 as tones (`SERIES` order). */
const SERIES_TONES: readonly ItemTone[] = [
  {
    dot: "bg-series-1",
    ink: "text-series-1",
    bar: "border-series-1/60 bg-series-1/20",
    colour: "var(--color-series-1)",
    navIcon: "text-series-1!",
  },
  {
    dot: "bg-series-2",
    ink: "text-series-2",
    bar: "border-series-2/60 bg-series-2/20",
    colour: "var(--color-series-2)",
    navIcon: "text-series-2!",
  },
  {
    dot: "bg-series-3",
    ink: "text-series-3",
    bar: "border-series-3/60 bg-series-3/20",
    colour: "var(--color-series-3)",
    navIcon: "text-series-3!",
  },
  {
    dot: "bg-series-4",
    ink: "text-series-4",
    bar: "border-series-4/60 bg-series-4/20",
    colour: "var(--color-series-4)",
    navIcon: "text-series-4!",
  },
  {
    dot: "bg-series-5",
    ink: "text-series-5",
    bar: "border-series-5/60 bg-series-5/20",
    colour: "var(--color-series-5)",
    navIcon: "text-series-5!",
  },
  {
    dot: "bg-series-6",
    ink: "text-series-6",
    bar: "border-series-6/60 bg-series-6/20",
    colour: "var(--color-series-6)",
    navIcon: "text-series-6!",
  },
  {
    dot: "bg-series-7",
    ink: "text-series-7",
    bar: "border-series-7/60 bg-series-7/20",
    colour: "var(--color-series-7)",
    navIcon: "text-series-7!",
  },
]

/** Labour (Resource Roles): series 1. */
export const LABOUR_TONE: ItemTone = SERIES_TONES[0]!

/** A Catalog Type's tone from its colour index (0 → series 2). */
export function catalogTypeTone(colourIndex: number): ItemTone {
  const slots = SERIES_TONES.length - 1
  return SERIES_TONES[1 + (((colourIndex % slots) + slots) % slots)]!
}

/** What a line (or a breakdown row) is: labour, or a Catalog Type. */
export interface ItemTypeRef {
  sourceKind: SourceKind
  catalogTypeId: string | null
}

/** The tone of a line's item type, given the Organization's Catalog Types. */
export function itemTone(
  line: ItemTypeRef,
  types: readonly CatalogTypeView[]
): ItemTone {
  if (line.sourceKind === "resource_role") return LABOUR_TONE
  const type = types.find((t) => t.id === line.catalogTypeId)
  return type ? catalogTypeTone(type.colourIndex) : SERIES_TONES[1]!
}

/**
 * The tone and name of a line's item type: the Resource Role term (Label
 * Override) or its Catalog Type's name.
 */
export function useItemType(line: ItemTypeRef): {
  tone: ItemTone
  singular: string
  plural: string
} {
  const labels = useLabels()
  const types = useCatalogTypes()
  if (line.sourceKind === "resource_role") {
    return { tone: LABOUR_TONE, ...labels.resource_role }
  }
  const type = types.find((t) => t.id === line.catalogTypeId)
  return {
    tone: itemTone(line, types),
    singular: type?.singular ?? "Catalog Item",
    plural: type?.plural ?? "Catalog Items",
  }
}

export const PHASE_TINT_CLASSES: Record<
  number,
  {
    /** A band or segment: the tint with its ink for text. */
    fill: string
    /** A small solid swatch (the saturated mark). */
    dot: string
    /** A Phase row's background (a lighter wash, with hover). */
    row: string
    /** A 3px bar on a row's leading edge. */
    edge: string
    /** A thin tree guide line. */
    guide: string
  }
> = {
  1: {
    fill: "bg-phase-1 text-phase-1-ink",
    dot: "bg-phase-1-mark",
    row: "bg-phase-1/55 hover:bg-phase-1/75",
    edge: "shadow-[inset_3px_0_0_var(--color-phase-1-mark)]",
    guide: "bg-phase-1-mark/45",
  },
  2: {
    fill: "bg-phase-2 text-phase-2-ink",
    dot: "bg-phase-2-mark",
    row: "bg-phase-2/55 hover:bg-phase-2/75",
    edge: "shadow-[inset_3px_0_0_var(--color-phase-2-mark)]",
    guide: "bg-phase-2-mark/45",
  },
  3: {
    fill: "bg-phase-3 text-phase-3-ink",
    dot: "bg-phase-3-mark",
    row: "bg-phase-3/55 hover:bg-phase-3/75",
    edge: "shadow-[inset_3px_0_0_var(--color-phase-3-mark)]",
    guide: "bg-phase-3-mark/45",
  },
  4: {
    fill: "bg-phase-4 text-phase-4-ink",
    dot: "bg-phase-4-mark",
    row: "bg-phase-4/55 hover:bg-phase-4/75",
    edge: "shadow-[inset_3px_0_0_var(--color-phase-4-mark)]",
    guide: "bg-phase-4-mark/45",
  },
  5: {
    fill: "bg-phase-5 text-phase-5-ink",
    dot: "bg-phase-5-mark",
    row: "bg-phase-5/55 hover:bg-phase-5/75",
    edge: "shadow-[inset_3px_0_0_var(--color-phase-5-mark)]",
    guide: "bg-phase-5-mark/45",
  },
}

/** An item type as a coloured swatch and its name. */
export function ItemTypeTag({
  line,
  className,
}: {
  line: ItemTypeRef
  className?: string
}) {
  const { tone, singular } = useItemType(line)
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", tone.dot)}
      />
      {singular}
    </span>
  )
}
