"use client"

import { toast } from "sonner"

import type { RouterInputs } from "@workspace/api"

import { patchLine, useQuoteCommand } from "@/components/quotes/autosave"
import type { EditorLine } from "@/components/quotes/autosave"
import { useTRPC } from "@/trpc/react"

type UpdateInput = RouterInputs["lineItem"]["update"]

/** The optimistic view of an update: the patched fields (price reset → Base Rate). */
function updatePatch(line: EditorLine, input: UpdateInput): Partial<EditorLine> {
  const patch: Partial<EditorLine> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.notes !== undefined) patch.notes = input.notes ?? null
  if (input.description !== undefined)
    patch.description = input.description ?? null
  if (input.startDate !== undefined) patch.startDate = input.startDate
  if (input.endDate !== undefined) patch.endDate = input.endDate
  if (input.quantity !== undefined) patch.quantity = String(input.quantity)
  if (input.unitPrice !== undefined) {
    patch.unitPrice =
      input.unitPrice === null ? line.basePrice : String(input.unitPrice)
  }
  return patch
}

/**
 * The Line Items tab's commands, each one gesture through
 * `useQuoteCommand`: `update` (one line's fields, applied optimistically),
 * `remove` (one or many lines, with an Undo toast that calls `restore`),
 * `add` (the Add Items sheet) and `setDiscount` (the Summary).
 */
export function useLineItemCommands(quoteId: string) {
  const trpc = useTRPC()

  const update = useQuoteCommand(
    quoteId,
    trpc.lineItem.update.mutationOptions(),
    {
      optimistic: (editor, input) => {
        const line = editor.lines.find((l) => l.id === input.id)
        return line ? patchLine(editor, input.id, updatePatch(line, input)) : editor
      },
    }
  )

  const restore = useQuoteCommand(
    quoteId,
    trpc.lineItem.restore.mutationOptions(),
    {
      onSuccess: (result) =>
        toast.success(
          result.lines.length === 1
            ? "Line Item restored."
            : `${result.lines.length} Line Items restored.`
        ),
    }
  )

  const remove = useQuoteCommand(
    quoteId,
    trpc.lineItem.delete.mutationOptions(),
    {
      optimistic: (editor, input) => ({
        ...editor,
        lines: editor.lines.filter((l) => !input.ids.includes(l.id)),
      }),
      onSuccess: (result) => {
        const n = result.deletedLineIds.length
        toast(n === 1 ? "Line Item deleted." : `${n} Line Items deleted.`, {
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

  const add = useQuoteCommand(quoteId, trpc.lineItem.add.mutationOptions())

  const setDiscount = useQuoteCommand(
    quoteId,
    trpc.quote.setDiscount.mutationOptions(),
    {
      optimistic: (editor, input) => ({
        ...editor,
        totals: {
          ...editor.totals,
          discountKind: input.discount?.kind ?? null,
          discountValue:
            input.discount === null ? null : String(input.discount.value),
        },
      }),
    }
  )

  return { add, update, remove, restore, setDiscount }
}
