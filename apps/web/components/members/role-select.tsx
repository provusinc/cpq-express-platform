"use client"

import { ROLE_LABELS, ROLES } from "@workspace/domain/enums"
import type { Role } from "@workspace/domain/enums"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

/** What each Role may do, in the words of the glossary. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Manages settings, catalog and members; edits any Quote.",
  manager: "Edits their own Quotes and those of Members.",
  member: "Edits only their own Quotes.",
}

export function RoleSelect({
  id,
  value,
  onChange,
  disabled,
  size,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  className,
}: {
  id?: string
  value: Role
  onChange: (role: Role) => void
  disabled?: boolean
  size?: "sm" | "default"
  "aria-label"?: string
  "aria-invalid"?: boolean
  className?: string
}) {
  return (
    <Select
      items={ROLE_LABELS}
      value={value}
      onValueChange={(next) => {
        if (next && next !== value) onChange(next as Role)
      }}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        size={size}
        className={className}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLES.map((role) => (
          <SelectItem key={role} value={role}>
            {ROLE_LABELS[role]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
