"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { useState } from "react"

import { cn } from "@workspace/ui/lib/utils"

import { useQuoteEditor } from "@/components/quotes/autosave"
import type { EditorMilestone } from "@/components/quotes/autosave"
import { useQuote } from "@/components/quotes/use-quote"
import { useLabels } from "@/components/shell/labels"
import { useCatalogTypes } from "@/components/shell/catalog-types"
import { catalogTypeTone, LABOUR_TONE } from "@/components/shell/tints"
import { useTRPC } from "@/trpc/react"

import { useMilestoneCommands } from "./commands"
import { TimelineGantt } from "./gantt"
import { MilestoneDialog } from "./milestone-dialog"
import type { MilestoneFormValues } from "./milestone-dialog"

/**
 * The Quote editor's Timeline tab: the Gantt (`TimelineGantt`: the
 * Milestones and the Line Items grouped by (nested) Phase, each Milestone
 * with its date line). Milestones are managed from the chart: Add Milestone
 * in its toolbar, and a Milestone's popup to complete, edit or delete it
 * (each an autosaving command; delete has an undo), or drag it to another
 * day. Read-only when the Quote is locked or the viewer may not edit it;
 * the server refuses regardless.
 */
export function TimelineTab({ quoteId }: { quoteId: string }) {
  const trpc = useTRPC()
  const quote = useQuote(quoteId)
  const editor = useQuoteEditor(quoteId)
  const { hoursPerDay } = useSuspenseQuery(
    trpc.settings.quoting.queryOptions()
  ).data
  const labels = useLabels()
  const catalogTypes = useCatalogTypes()
  const commands = useMilestoneCommands(quoteId)
  const readOnly = !quote.permissions.canEdit
  const [editing, setEditing] = useState<EditorMilestone | "new" | null>(null)

  const { phases, lines, milestones } = editor

  const save = (values: Partial<MilestoneFormValues>) => {
    if (editing === "new") {
      const full = values as MilestoneFormValues
      return commands.create.mutateAsync({
        quoteId,
        ...full,
        description: full.description || null,
      })
    }
    return commands.update.mutateAsync({
      quoteId,
      id: (editing as EditorMilestone).id,
      ...values,
      ...(values.description !== undefined && {
        description: values.description || null,
      }),
    })
  }

  // Labour and every active Catalog Type; an inactive one only when used.
  const legend = [
    {
      key: "resource_role",
      bar: LABOUR_TONE.bar,
      name: labels.resource_role.singular,
    },
    ...catalogTypes
      .filter(
        (type) => type.active || lines.some((l) => l.catalogTypeId === type.id)
      )
      .map((type) => ({
        key: type.id,
        bar: catalogTypeTone(type.colourIndex).bar,
        name: type.singular,
      })),
  ]

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section className="flex flex-col gap-2" aria-label="Timeline">
        <TimelineGantt
          quote={quote}
          hoursPerDay={hoursPerDay}
          currency={editor.totals.currencyCode}
          phases={phases}
          lines={lines}
          milestones={milestones}
          milestoneActions={
            readOnly
              ? undefined
              : {
                  onToggle: (m, completed) =>
                    commands.update.mutate({ quoteId, id: m.id, completed }),
                  onEdit: setEditing,
                  onDelete: (m) =>
                    commands.remove.mutate({ quoteId, id: m.id }),
                }
          }
          onAddMilestone={readOnly ? undefined : () => setEditing("new")}
        />
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          {legend.map((entry) => (
            <span key={entry.key} className="flex items-center gap-1.5">
              <span className={cn("h-2.5 w-4 border", entry.bar)} />
              {entry.name}
            </span>
          ))}
          {lines.some((l) => l.sourceKind === "resource_role") && (
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2.5 w-8 bg-linear-to-r from-series-1/25 to-series-1/80"
              />
              Hours per period
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-4 bg-muted-foreground/40" />
            {labels.phase.singular}
          </span>
          {milestones.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2 rotate-45 rounded-[1px] bg-muted-foreground"
              />
              Milestone
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span className="h-3 border-l-2 border-destructive/70" />
            Today
          </span>
        </div>
      </section>

      {!readOnly && editing !== null && (
        <MilestoneDialog
          key={editing === "new" ? "new" : editing.id}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          milestone={editing === "new" ? null : editing}
          defaultDate={quote.startDate}
          onSave={save}
        />
      )}
    </div>
  )
}
