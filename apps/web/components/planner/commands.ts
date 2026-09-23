"use client"

import { toast } from "sonner"

import type { RouterInputs } from "@workspace/api"
import type { TimePeriod } from "@workspace/domain/enums"

import { useQuoteCommand } from "@/components/quotes/autosave"
import type { EditorLine } from "@/components/quotes/autosave"
import { applyEditsLocally } from "@/lib/planner"
import { useTRPC } from "@/trpc/react"

type SetRangeInput = RouterInputs["allocation"]["setRange"]

/**
 * The Resource Planner's commands through `useQuoteCommand`:
 * - `setRange(cells, { undoMessage? })`: one gesture (a cell, a range fill,
 *   a drag-fill, fill or clear row) as one `allocation.setRange`, applied
 *   optimistically with the domain's `applyAllocationEdits` (so the row,
 *   quantity and Quote totals move at once). With `undoMessage`, a toast
 *   offers Undo (`allocation.restore`).
 * - `restore`: the undo.
 */
export function usePlannerCommands(
  quoteId: string,
  quote: { timePeriod: TimePeriod; startDate: string; endDate: string }
) {
  const trpc = useTRPC()

  const restore = useQuoteCommand(
    quoteId,
    trpc.allocation.restore.mutationOptions(),
    { onSuccess: () => toast.success("Restored.") }
  )

  const mutation = useQuoteCommand(
    quoteId,
    trpc.allocation.setRange.mutationOptions(),
    {
      optimistic: (editor, input) => {
        const patches = applyEditsLocally<EditorLine>(
          editor.lines,
          input.cells.map((c) => ({
            lineItemId: c.lineItemId,
            periodStart: c.periodStart,
            amount: c.amount === null ? null : String(c.amount),
          })),
          quote.timePeriod,
          quote
        )
        return {
          ...editor,
          lines: editor.lines.map((l) => {
            const patch = patches.get(l.id)
            return patch ? { ...l, ...patch } : l
          }),
        }
      },
    }
  )

  const setRange = (
    cells: SetRangeInput["cells"],
    { undoMessage }: { undoMessage?: string } = {}
  ) => {
    if (cells.length === 0) return
    mutation.mutate(
      { quoteId, cells },
      {
        onSuccess: (result) => {
          if (!undoMessage) return
          toast(undoMessage, {
            duration: 10_000,
            action: {
              label: "Undo",
              onClick: () =>
                restore.mutate({ quoteId, undoToken: result.undoToken }),
            },
          })
        },
      }
    )
  }

  return { setRange, restore, pending: mutation.isPending }
}
