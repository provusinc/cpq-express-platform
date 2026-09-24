"use client"

import { toast } from "sonner"

import type { RouterInputs } from "@workspace/api"

import { patchLine, useQuoteCommand } from "@/components/quotes/autosave"
import type { EditorLine } from "@/components/quotes/autosave"
import { useLabels } from "@/components/shell/labels"
import {
  moveLinesLocally,
  movePhaseLocally,
  subtreeIds,
} from "@/lib/phase-tree"
import { useTRPC } from "@/trpc/react"

type UpdateInput = RouterInputs["lineItem"]["update"]

/** The optimistic view of an update: the patched fields (price reset → Base Rate). */
function updatePatch(
  line: EditorLine,
  input: UpdateInput
): Partial<EditorLine> {
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

const count = (n: number, one: string, many: string) =>
  n === 1 ? `1 ${one}` : `${n} ${many}`

/**
 * The Line Items tab's commands, each one gesture through
 * `useQuoteCommand`:
 * - Line Items: `update` (one line's fields, optimistic), `remove` (one or
 *   many, with an Undo toast that calls `restore`), `add` (the Add Items
 *   sheet), `move` (a drop or bulk move, optimistic) and `clone` (in place
 *   or into another Phase);
 * - Phases: `createPhase`, `renamePhase` and `movePhase` (optimistic),
 *   `removePhase` (cascades, with an Undo toast that calls `restorePhase`)
 *   and `clonePhase`.
 */
export function useLineItemCommands(quoteId: string) {
  const trpc = useTRPC()
  const labels = useLabels()

  const update = useQuoteCommand(
    quoteId,
    trpc.lineItem.update.mutationOptions(),
    {
      optimistic: (editor, input) => {
        const line = editor.lines.find((l) => l.id === input.id)
        return line
          ? patchLine(editor, input.id, updatePatch(line, input))
          : editor
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

  const move = useQuoteCommand(quoteId, trpc.lineItem.move.mutationOptions(), {
    optimistic: (editor, input) => ({
      ...editor,
      lines: moveLinesLocally(editor.phases, editor.lines, input),
    }),
  })

  const clone = useQuoteCommand(
    quoteId,
    trpc.lineItem.clone.mutationOptions(),
    {
      onSuccess: (_, input) =>
        toast.success(
          input.ids.length === 1
            ? "Line Item cloned."
            : `${input.ids.length} Line Items cloned.`
        ),
    }
  )

  const createPhase = useQuoteCommand(
    quoteId,
    trpc.phase.create.mutationOptions()
  )

  const renamePhase = useQuoteCommand(
    quoteId,
    trpc.phase.rename.mutationOptions(),
    {
      optimistic: (editor, input) => ({
        ...editor,
        phases: editor.phases.map((p) =>
          p.id === input.id ? { ...p, name: input.name } : p
        ),
      }),
    }
  )

  const movePhase = useQuoteCommand(
    quoteId,
    trpc.phase.move.mutationOptions(),
    {
      optimistic: (editor, input) => ({
        ...editor,
        phases: movePhaseLocally(editor.phases, input),
      }),
    }
  )

  const restorePhase = useQuoteCommand(
    quoteId,
    trpc.phase.restore.mutationOptions(),
    {
      onSuccess: (result) =>
        toast.success(
          `${result.phases[0]?.name ?? labels.phase.singular} restored.`
        ),
    }
  )

  const removePhase = useQuoteCommand(
    quoteId,
    trpc.phase.delete.mutationOptions(),
    {
      optimistic: (editor, input) => {
        const gone = subtreeIds(editor.phases, input.id)
        return {
          ...editor,
          phases: editor.phases.filter((p) => !gone.has(p.id)),
          lines: editor.lines.filter(
            (l) => l.phaseId === null || !gone.has(l.phaseId)
          ),
        }
      },
      onSuccess: (result) => {
        const lines = result.deletedLineIds.length
        const phases = result.deletedPhaseIds.length
        toast(
          `Deleted ${count(phases, labels.phase.singular, labels.phase.plural)}${
            lines ? ` and ${count(lines, "Line Item", "Line Items")}` : ""
          }.`,
          {
            duration: 10_000,
            action: {
              label: "Undo",
              onClick: () =>
                restorePhase.mutate({ quoteId, undoToken: result.undoToken }),
            },
          }
        )
      },
    }
  )

  const clonePhase = useQuoteCommand(
    quoteId,
    trpc.phase.clone.mutationOptions(),
    {
      onSuccess: () => toast.success(`${labels.phase.singular} cloned.`),
    }
  )

  return {
    add,
    update,
    remove,
    restore,
    move,
    clone,
    createPhase,
    renamePhase,
    movePhase,
    removePhase,
    restorePhase,
    clonePhase,
  }
}

export type LineItemCommands = ReturnType<typeof useLineItemCommands>
