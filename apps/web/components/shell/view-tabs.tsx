"use client"

import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { cn } from "@workspace/ui/lib/utils"

/** One tab of a list's views: a label, its count and an optional dot. */
export interface ListView<V extends string> {
  value: V
  label: string
  /** Rows in this view under the list's other filters. */
  count?: number
  /** A solid colour class for a leading dot (e.g. `STATUS_SOLID`). */
  dot?: string
}

/**
 * The views above a list (All · Draft · … or Active · Inactive · All): a
 * stock shadcn `Tabs` line list, each tab with its count, mapped by the
 * caller onto the list's status filter. `value` is `null` when the filter
 * matches no single view (e.g. two statuses chosen in the toolbar). The row
 * has a hairline under it and `summary` (the result count) at its right;
 * wide sets scroll sideways inside their own row.
 */
export function ViewTabs<V extends string>({
  views,
  value,
  onValueChange,
  label,
  summary,
  className,
}: {
  views: ListView<V>[]
  value: V | null
  onValueChange: (value: V) => void
  /** The tab list's accessible name, e.g. "Quote status". */
  label: string
  /** A short line at the right, e.g. "23 Quotes match". */
  summary?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn("flex items-end justify-between gap-4 border-b", className)}
    >
      <Tabs
        value={value}
        onValueChange={(next) => onValueChange(next as V)}
        className="-mb-px max-w-full min-w-0"
      >
        <div className="-mx-1 overflow-x-auto px-1 pb-1.5">
          <TabsList variant="line" aria-label={label} className="gap-0.5">
            {views.map((view) => (
              <TabsTrigger
                key={view.value}
                value={view.value}
                className="flex-none gap-1 px-1.5 text-[0.8125rem]"
              >
                {view.dot && (
                  <span
                    aria-hidden
                    className={cn("size-1.5 shrink-0 rounded-full", view.dot)}
                  />
                )}
                {view.label}
                {view.count !== undefined && (
                  <span
                    className={cn(
                      "min-w-4.5 rounded-full bg-muted px-1 text-center text-[0.7rem] leading-4 font-medium text-muted-foreground tabular-nums",
                      "in-data-active:bg-accent in-data-active:text-primary"
                    )}
                  >
                    {view.count}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>
      {summary !== undefined && (
        <p
          className="shrink-0 pb-2.5 text-xs whitespace-nowrap text-muted-foreground"
          aria-live="polite"
        >
          {summary}
        </p>
      )}
    </div>
  )
}
