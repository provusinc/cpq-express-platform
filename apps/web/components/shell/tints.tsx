"use client"

import type { SourceKind } from "@workspace/domain/enums"
import { cn } from "@workspace/ui/lib/utils"

import { useLabels } from "./labels"

/**
 * The app's identifying colours, one place for every surface (the Line
 * Items grid, the Planner, the Timeline, the Overview, the Add Items
 * sheet, the sidebar), so the same thing always has the same colour:
 *
 * - an item type (Resource Role, Product, Add-on) is its chart series
 *   (`SERIES`: labour, Products, Add-ons);
 * - a Phase is its top-level Phase's tint (`phaseTints` in
 *   `lib/phase-tints.ts`).
 *
 * Tailwind only sees whole class names, so every variant is spelled out.
 */
export const SOURCE_KIND_TONES = {
  resource_role: {
    /** A small solid swatch. */
    dot: "bg-series-1",
    /** An icon or text in the colour. */
    ink: "text-series-1",
    /** A bar: light fill with a stronger edge (Timeline bars, legends). */
    bar: "border-series-1/60 bg-series-1/20",
    /** The raw colour, for inline styles and CSS variables. */
    colour: "var(--color-series-1)",
    /** A nav icon (important: the sidebar button styles its icons). */
    navIcon: "text-series-1!",
  },
  product: {
    dot: "bg-series-2",
    ink: "text-series-2",
    bar: "border-series-2/60 bg-series-2/20",
    colour: "var(--color-series-2)",
    navIcon: "text-series-2!",
  },
  add_on: {
    dot: "bg-series-3",
    ink: "text-series-3",
    bar: "border-series-3/60 bg-series-3/20",
    colour: "var(--color-series-3)",
    navIcon: "text-series-3!",
  },
} as const satisfies Record<SourceKind, Record<string, string>>

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

/** The icon colour of a nav entry that lists an item type (the catalog). */
export function navIconClass(term: string | undefined) {
  return term && term in SOURCE_KIND_TONES
    ? SOURCE_KIND_TONES[term as SourceKind].navIcon
    : undefined
}

/** An item type as a coloured swatch and its (relabelled) name. */
export function SourceKindTag({
  kind,
  className,
}: {
  kind: SourceKind
  className?: string
}) {
  const labels = useLabels()
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          SOURCE_KIND_TONES[kind].dot
        )}
      />
      {labels[kind].singular}
    </span>
  )
}
