"use client"

import { FlagIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"

import { MILESTONE_TYPE_LABELS } from "@workspace/domain/enums"
import { phaseRollups } from "@workspace/domain/phases"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { cn } from "@workspace/ui/lib/utils"

import { useQuoteEditor } from "@/components/quotes/autosave"
import type { EditorMilestone } from "@/components/quotes/autosave"
import { useQuote } from "@/components/quotes/quote-header"
import { useLabels } from "@/components/shell/labels"
import { formatDate } from "@/lib/format"
import { visibleTreeRows } from "@/lib/phase-tree"
import { timelineRange } from "@/lib/timeline"

import { useMilestoneCommands } from "./commands"
import { Gantt, SOURCE_BAR_CLASSES } from "./gantt"
import type { TimelineRow } from "./gantt"
import { MilestoneDialog } from "./milestone-dialog"
import type { MilestoneFormValues } from "./milestone-dialog"

/** Today in UTC, `yyyy-MM-dd` (the dates the Quote uses). */
const utcToday = () => new Date().toISOString().slice(0, 10)

/**
 * The Quote editor's Timeline tab: the Gantt of Line Items grouped by
 * (nested) Phase with the Milestones marked, and the Milestone list with
 * add, edit, complete and delete (each an autosaving command; delete has
 * an undo). Read-only when the Quote is locked or the viewer may not edit
 * it; the server refuses regardless.
 */
export function TimelineTab({ quoteId }: { quoteId: string }) {
  const quote = useQuote(quoteId)
  const editor = useQuoteEditor(quoteId)
  const labels = useLabels()
  const commands = useMilestoneCommands(quoteId)
  const readOnly = !quote.permissions.canEdit
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [editing, setEditing] = useState<EditorMilestone | "new" | null>(null)
  const [today] = useState(utcToday)

  const { phases, lines, milestones } = editor
  const phaseById = new Map(phases.map((p) => [p.id, p]))
  const lineById = new Map(lines.map((l) => [l.id, l]))
  const rollups = phaseRollups(phases, lines)
  const rows: TimelineRow[] = visibleTreeRows(phases, lines, collapsed).map(
    (row) =>
      row.kind === "phase"
        ? {
            kind: "phase",
            phase: phaseById.get(row.id)!,
            depth: row.depth,
            rollup: rollups[row.id]!,
          }
        : { kind: "line", line: lineById.get(row.id)!, depth: row.depth }
  )
  const range = timelineRange(
    quote,
    lines,
    milestones.map((m) => m.date)
  )

  const toggle = (phaseId: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(phaseId)) next.delete(phaseId)
      else next.add(phaseId)
      return next
    })

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

  const legend = (["resource_role", "product", "add_on"] as const).filter(
    (kind) => labels[kind].enabled || lines.some((l) => l.sourceKind === kind)
  )

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section className="flex flex-col gap-2" aria-label="Timeline">
        <Gantt
          rows={rows}
          milestones={milestones}
          range={range}
          today={today}
          collapsed={collapsed}
          onToggle={toggle}
          onSelectMilestone={
            readOnly
              ? undefined
              : (id) => setEditing(milestones.find((m) => m.id === id) ?? null)
          }
        />
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          {legend.map((kind) => (
            <span key={kind} className="flex items-center gap-1.5">
              <span
                className={cn("h-2.5 w-4 rounded-sm", SOURCE_BAR_CLASSES[kind])}
              />
              {labels[kind].singular}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-4 rounded-sm bg-foreground/70" />
            {labels.phase.singular}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 border-l-2 border-destructive/70" />
            Today
          </span>
        </div>
      </section>

      <section
        className="flex flex-col gap-3"
        aria-labelledby="milestones-heading"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id="milestones-heading" className="text-base font-semibold">
            Milestones
          </h2>
          {!readOnly && (
            <Button onClick={() => setEditing("new")}>
              <PlusIcon data-icon="inline-start" />
              Add Milestone
            </Button>
          )}
        </div>
        {milestones.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FlagIcon />
              </EmptyMedia>
              <EmptyTitle>No Milestones yet</EmptyTitle>
              <EmptyDescription>
                {readOnly
                  ? "This Quote has no Milestones."
                  : "Mark key dates — deadlines, reviews, payments due — to show them on the Timeline."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Done</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  {!readOnly && (
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {milestones.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <Checkbox
                        aria-label={`${m.name} completed`}
                        checked={m.completed}
                        disabled={readOnly}
                        onCheckedChange={(checked) =>
                          commands.update.mutate({
                            quoteId,
                            id: m.id,
                            completed: checked === true,
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2 font-medium">
                        <span
                          aria-hidden
                          className="size-2.5 shrink-0 rotate-45 rounded-[2px]"
                          style={{ backgroundColor: m.colour }}
                        />
                        <span
                          className={cn(
                            m.completed && "text-muted-foreground line-through"
                          )}
                        >
                          {m.name}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatDate(m.date)}
                    </TableCell>
                    <TableCell>{MILESTONE_TYPE_LABELS[m.type]}</TableCell>
                    <TableCell className="max-w-80 truncate text-muted-foreground">
                      {m.description}
                    </TableCell>
                    {!readOnly && (
                      <TableCell className="text-right whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Edit ${m.name}`}
                          onClick={() => setEditing(m)}
                        >
                          <PencilIcon />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Delete ${m.name}`}
                          onClick={() =>
                            commands.remove.mutate({ quoteId, id: m.id })
                          }
                        >
                          <Trash2Icon />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
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
