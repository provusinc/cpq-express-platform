"use client"

import { toast } from "sonner"

import { useQuoteCommand } from "@/components/quotes/autosave"
import { useTRPC } from "@/trpc/react"

/**
 * The Timeline's Milestone commands, each one gesture through
 * `useQuoteCommand`: `create`, `update` (optimistic, only the changed
 * fields), `remove` (optimistic, with an Undo toast that calls `restore`).
 */
export function useMilestoneCommands(quoteId: string) {
  const trpc = useTRPC()

  const create = useQuoteCommand(
    quoteId,
    trpc.milestone.create.mutationOptions()
  )

  const update = useQuoteCommand(
    quoteId,
    trpc.milestone.update.mutationOptions(),
    {
      optimistic: (editor, input) => ({
        ...editor,
        milestones: editor.milestones.map((m) =>
          m.id === input.id
            ? {
                ...m,
                ...(input.name !== undefined && { name: input.name }),
                ...(input.date !== undefined && { date: input.date }),
                ...(input.type !== undefined && { type: input.type }),
                ...(input.colour !== undefined && { colour: input.colour }),
                ...(input.completed !== undefined && {
                  completed: input.completed,
                }),
                ...(input.description !== undefined && {
                  description: input.description || null,
                }),
              }
            : m
        ),
      }),
    }
  )

  const restore = useQuoteCommand(
    quoteId,
    trpc.milestone.restore.mutationOptions(),
    {
      onSuccess: (result) =>
        toast.success(
          `“${result.milestones[0]?.name ?? "Milestone"}” restored.`
        ),
    }
  )

  const remove = useQuoteCommand(
    quoteId,
    trpc.milestone.delete.mutationOptions(),
    {
      optimistic: (editor, input) => ({
        ...editor,
        milestones: editor.milestones.filter((m) => m.id !== input.id),
      }),
      onSuccess: (result) =>
        toast("Milestone deleted.", {
          duration: 10_000,
          action: {
            label: "Undo",
            onClick: () =>
              restore.mutate({ quoteId, undoToken: result.undoToken }),
          },
        }),
    }
  )

  return { create, update, remove, restore }
}
