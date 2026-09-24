"use client"

import { useState } from "react"

import { Input } from "@workspace/ui/components/input"

import { isMoneyInput } from "@/lib/money"

/**
 * Min/max amount inputs for a list filter. Reports a bound only once it is a
 * valid amount (or cleared), so a half-typed value never reaches the API.
 */
export function PriceRangeFilter({
  label,
  onChange,
}: {
  label: string
  onChange: (range: { min?: string; max?: string }) => void
}) {
  const [min, setMin] = useState("")
  const [max, setMax] = useState("")
  const bound = (v: string) => (isMoneyInput(v) ? v.trim() : undefined)
  const valid = (v: string) => v.trim() === "" || isMoneyInput(v)

  const update = (nextMin: string, nextMax: string) => {
    setMin(nextMin)
    setMax(nextMax)
    if (valid(nextMin) && valid(nextMax)) {
      onChange({ min: bound(nextMin), max: bound(nextMax) })
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        aria-label={`Minimum ${label}`}
        aria-invalid={!valid(min)}
        placeholder={`Min ${label}`}
        inputMode="decimal"
        className="h-8 w-28"
        value={min}
        onChange={(e) => update(e.target.value, max)}
      />
      <span className="text-muted-foreground">–</span>
      <Input
        aria-label={`Maximum ${label}`}
        aria-invalid={!valid(max)}
        placeholder={`Max ${label}`}
        inputMode="decimal"
        className="h-8 w-28"
        value={max}
        onChange={(e) => update(min, e.target.value)}
      />
    </div>
  )
}
