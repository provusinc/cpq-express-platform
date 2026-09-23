"use client"

import { TagIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

/** Pick tags to filter by; items must carry every selected tag. */
export function TagsFilter({
  tags,
  selected,
  onChange,
}: {
  tags: readonly string[]
  selected: readonly string[]
  onChange: (tags: string[]) => void
}) {
  const toggle = (tag: string, on: boolean) =>
    onChange(on ? [...selected, tag] : selected.filter((t) => t !== tag))
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" disabled={tags.length === 0} />}
      >
        <TagIcon data-icon="inline-start" />
        {selected.length === 0 ? "Tags" : `Tags (${selected.length})`}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-72 overflow-y-auto">
        {tags.map((tag) => (
          <DropdownMenuCheckboxItem
            key={tag}
            checked={selected.includes(tag)}
            onCheckedChange={(on) => toggle(tag, on === true)}
          >
            {tag}
          </DropdownMenuCheckboxItem>
        ))}
        {selected.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onChange([])}>
              Clear tags
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
