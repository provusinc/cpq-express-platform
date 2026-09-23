"use client"

import type { ChartConfig } from "@workspace/ui/components/chart"

/**
 * A `ChartTooltipContent` `formatter` that shows each series with its
 * colour, its configured label and `format(value)` (e.g. money in the
 * Quote's currency) instead of a bare number. `nameKey` names the data
 * field that identifies the row's series (one bar per category), else the
 * series is the Bar's own name.
 */
export function tooltipRow(
  config: ChartConfig,
  format: (value: number, key: string) => string,
  nameKey?: string
) {
  return function TooltipRow(value: unknown, name: unknown, item: unknown) {
    const entry = item as {
      color?: string
      payload?: Record<string, unknown> & { fill?: string }
    }
    const key = nameKey ? String(entry.payload?.[nameKey]) : String(name)
    const color = entry.payload?.fill ?? entry.color
    return (
      <div className="flex w-full items-center gap-2">
        <span
          className="size-2.5 shrink-0 rounded-[2px]"
          style={{ backgroundColor: color }}
        />
        <span className="text-muted-foreground">
          {config[key]?.label ?? key}
        </span>
        <span className="ml-auto font-mono font-medium text-foreground tabular-nums">
          {format(Number(value), key)}
        </span>
      </div>
    )
  }
}
