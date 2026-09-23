"use client"

import { useState } from "react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"

/**
 * An always-editable text field for autosave (ADR-0003): it looks like
 * plain text until hovered or focused, and saves on blur or Enter (⌘/Ctrl +
 * Enter when `multiline`). Escape restores the saved value. An unchanged
 * value isn't saved; a blank `required` value, or one `validate` rejects
 * (it returns the message to show), is refused and restored.
 * While not focused it follows `value`, so a colleague's change shows up
 * after a refetch.
 */
export function InlineText({
  value,
  onSave,
  label,
  placeholder,
  disabled,
  required,
  multiline,
  maxLength,
  validate,
  inputMode,
  className,
}: {
  value: string | null
  /** Called with the trimmed new value (blank → null). */
  onSave: (value: string | null) => void
  /** Accessible name. */
  label: string
  placeholder?: string
  disabled?: boolean
  required?: boolean
  multiline?: boolean
  maxLength?: number
  /** A message when the trimmed, non-blank value is invalid; null when fine. */
  validate?: (value: string) => string | null
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]
  className?: string
}) {
  const [draft, setDraft] = useState(value ?? "")
  const [synced, setSynced] = useState(value)
  const [focused, setFocused] = useState(false)
  // Follow the saved value while the user isn't typing.
  if (!focused && value !== synced) {
    setSynced(value)
    setDraft(value ?? "")
  }

  const commit = () => {
    setFocused(false)
    const next = draft.trim()
    if (required && !next) {
      toast.error(`${label} can't be blank.`)
      setDraft(value ?? "")
      return
    }
    const problem = next && validate ? validate(next) : null
    if (problem) {
      toast.error(problem)
      setDraft(value ?? "")
      return
    }
    setDraft(next)
    if (next === (value ?? "")) return
    setSynced(next || null)
    onSave(next || null)
  }

  const props = {
    "aria-label": label,
    value: draft,
    placeholder,
    disabled,
    maxLength,
    onFocus: () => setFocused(true),
    onBlur: commit,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(e.target.value),
    onKeyDown: (
      e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => {
      if (e.key === "Escape") {
        setDraft(value ?? "")
        setFocused(false)
        // Blur without saving: the draft is back to the saved value.
        requestAnimationFrame(() => e.currentTarget?.blur())
      } else if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        e.currentTarget.blur()
      }
    },
    className: cn(
      "w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1 transition-colors outline-none",
      "placeholder:text-muted-foreground",
      "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 enabled:hover:border-input",
      "disabled:cursor-default",
      className
    ),
  }
  return multiline ? (
    <textarea
      {...props}
      rows={Math.min(4, Math.max(1, draft.split("\n").length))}
    />
  ) : (
    <input {...props} type="text" inputMode={inputMode} />
  )
}
