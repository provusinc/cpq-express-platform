"use client"

import { ArrowDownIcon, ArrowUpIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

import type { ColumnLayout } from "@/lib/column-layout"
import { moveColumn } from "@/lib/column-layout"

/**
 * Show, hide and reorder a list's columns. Every change applies at once
 * (and is saved by the caller); fixed columns are listed but locked.
 */
export function ColumnsDialog({
  open,
  onOpenChange,
  layout,
  labels,
  fixed,
  onChange,
  onReset,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  layout: ColumnLayout
  labels: Record<string, string>
  fixed: readonly string[]
  onChange: (layout: ColumnLayout) => void
  onReset: () => void
}) {
  const movable = layout.order.filter((id) => !fixed.includes(id))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Columns</DialogTitle>
          <DialogDescription>
            Choose and order the columns. Your layout is remembered.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-1" aria-label="Columns">
          {layout.order.map((id) => {
            const locked = fixed.includes(id)
            const index = movable.indexOf(id)
            return (
              <li
                key={id}
                className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-muted/50"
              >
                <Checkbox
                  id={`column-${id}`}
                  checked={layout.visibility[id] !== false}
                  disabled={locked}
                  onCheckedChange={(checked) =>
                    onChange({
                      ...layout,
                      visibility: {
                        ...layout.visibility,
                        [id]: checked === true,
                      },
                    })
                  }
                />
                <label htmlFor={`column-${id}`} className="flex-1 text-sm">
                  {labels[id] ?? id}
                  {locked && (
                    <span className="ml-1 text-muted-foreground">(always)</span>
                  )}
                </label>
                {!locked && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Move ${labels[id]} up`}
                      disabled={index === 0}
                      onClick={() =>
                        onChange({
                          ...layout,
                          order: moveColumn(layout.order, id, -1, fixed),
                        })
                      }
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Move ${labels[id]} down`}
                      disabled={index === movable.length - 1}
                      onClick={() =>
                        onChange({
                          ...layout,
                          order: moveColumn(layout.order, id, 1, fixed),
                        })
                      }
                    >
                      <ArrowDownIcon />
                    </Button>
                  </>
                )}
              </li>
            )
          })}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onReset}>
            Reset to default
          </Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
