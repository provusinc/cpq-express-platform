"use client"

import { useState } from "react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"

/**
 * An always-editable date (`yyyy-MM-dd`) for autosave grids: saves on blur
 * or Enter when the value changed, Escape restores it. Outside `min`/`max`
 * is refused with a toast (the server checks again). While not focused it
 * follows `value`.
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
  const [draft, setDraft] = useState(value)
  const [synced, setSynced] = useState(value)
  const [focused, setFocused] = useState(false)
  if (!focused && value !== synced) {
    setSynced(value)
    setDraft(value)
  }

  const commit = () => {
    setFocused(false)
    if (!draft || draft === value) {
      setDraft(value)
      return
    }
    if ((min && draft < min) || (max && draft > max)) {
      toast.error(`Pick a date between ${min} and ${max}.`)
      setDraft(value)
      return
    }
    setSynced(draft)
    onSave(draft)
  }

  return (
    <input
      type="date"
      aria-label={label}
      value={draft}
      min={min}
      max={max}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onBlur={commit}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          e.currentTarget.blur()
        } else if (e.key === "Escape") {
          setDraft(value)
          setFocused(false)
          requestAnimationFrame(() => e.currentTarget?.blur())
        }
      }}
      className={cn(
        "w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm tabular-nums transition-colors outline-none",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 enabled:hover:border-input",
        "disabled:cursor-default",
        className
      )}
    />
  )
}
