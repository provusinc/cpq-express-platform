"use client"

import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Calendar } from "@workspace/ui/components/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { cn } from "@workspace/ui/lib/utils"

import { formatDate, fromLocalDay, todayIsoDate } from "@/lib/format"

/** A `yyyy-MM-dd` day as the local `Date` react-day-picker shows as that day. */
function localDay(day: string) {
  return new Date(fromLocalDay(day)!)
}

/**
 * A compact date (`yyyy-MM-dd`) for autosave grids: the date as text ("Oct
 * 5, 2026") that opens a shadcn Calendar in a popover; picking a day saves
 * it (when it changed) and closes. Days outside `min`/`max` can't be picked
 * (the server checks again). Disabled, it is plain text.
 */
export function InlineDate({
  value,
  onSave,
  label,
  min,
  max,
  disabled,
  className,
}: {
  value: string
  onSave: (value: string) => void
  /** Accessible name. */
  label: string
  min?: string
  max?: string
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const text = formatDate(value)
  if (disabled) {
    return (
      <span
        aria-label={`${label}: ${text}`}
        className={cn(
          "block px-2 py-1 text-sm whitespace-nowrap tabular-nums",
          className
        )}
      >
        {text}
      </span>
    )
  }
  const selected = localDay(value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label={`${label}: ${text}`}
            className={cn(
              "h-7 px-2 text-sm font-normal whitespace-nowrap tabular-nums",
              className
            )}
          />
        }
      >
        {text}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          weekStartsOn={1}
          selected={selected}
          defaultMonth={selected}
          startMonth={min ? localDay(min) : undefined}
          endMonth={max ? localDay(max) : undefined}
          disabled={[
            ...(min ? [{ before: localDay(min) }] : []),
            ...(max ? [{ after: localDay(max) }] : []),
          ]}
          onSelect={(date) => {
            setOpen(false)
            if (!date) return
            const day = todayIsoDate(date)
            if (day !== value) onSave(day)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
