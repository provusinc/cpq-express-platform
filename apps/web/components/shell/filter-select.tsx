"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

const ALL = "__all__"

/**
 * A compact select for list filters. `value` undefined means "all"; the
 * first option is `allLabel`.
 */
export function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
  className = "w-40",
}: {
  /** Accessible name (the trigger shows the current option). */
  label: string
  allLabel: string
  value: string | undefined
  options: readonly { value: string; label: string }[]
  onChange: (value: string | undefined) => void
  className?: string
}) {
  const items = [{ value: ALL, label: allLabel }, ...options]
  return (
    <Select
      items={items}
      value={value ?? ALL}
      onValueChange={(next) =>
        onChange(next === ALL || next == null ? undefined : String(next))
      }
    >
      <SelectTrigger aria-label={label} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
