"use client"

import type { RowSelectionState } from "@tanstack/react-table"
import {
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  CopyIcon,
  FolderInputIcon,
  FolderPlusIcon,
  ListPlusIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { useState } from "react"

import { phaseRollups } from "@workspace/domain/phases"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import { useQuoteEditor } from "@/components/quotes/autosave"
import { useQuote } from "@/components/quotes/use-quote"
import { ConfirmDialog } from "@/components/shell/confirm-dialog"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/shell/empty"
import { useLabels } from "@/components/shell/labels"
import {
  nestRows,
  phaseOptions,
  subtreeIds,
  visibleTreeRows,
} from "@/lib/phase-tree"

import { AddItemsSheet } from "./add-items-sheet"
import { useLineItemCommands } from "./commands"
import { LineItemsGrid, phaseRowId } from "./line-items-grid"
import type { GridActions, GridRow } from "./line-items-grid"
import { PhaseDialog } from "./phase-dialog"

const NO_COLLAPSED: ReadonlySet<string> = new Set()

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

/**
 * The Quote editor's Line Items tab: the grid of Phases (nested up to
 * three levels, expand/collapse) and Line Items with inline autosaving
 * edits, drag-and-drop, bulk move/clone/delete with undo and the Add Items
 * sheet, at full width (the figures and the Quote Discount are in the
 * header). Read-only (no add, edit,
 * move or delete) when the Quote is locked or the viewer may not edit it;
 * the server refuses regardless.
 */
export function LineItemsTab({ quoteId }: { quoteId: string }) {
  const quote = useQuote(quoteId)
  const editor = useQuoteEditor(quoteId)
  const labels = useLabels()
  const phaseTerm = labels.phase
  const commands = useLineItemCommands(quoteId)
  const readOnly = !quote.permissions.canEdit
  const [adding, setAdding] = useState(false)
  const [addPhaseId, setAddPhaseId] = useState<string | null>(null)
  const [selection, setSelection] = useState<RowSelectionState>({})
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [newPhaseParent, setNewPhaseParent] = useState<{
    parentId: string | null
  } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const { phases, lines } = editor
  const phaseById = new Map(phases.map((p) => [p.id, p]))
  const lineById = new Map(lines.map((l) => [l.id, l]))
  const rollups = phaseRollups(phases, lines)
  // Every row in grid order, nested by Phase for the tree table (which
  // leaves out the contents of collapsed Phases itself).
  const tree = nestRows(
    visibleTreeRows(phases, lines, NO_COLLAPSED).map(
      (row): GridRow & { container: string | null } =>
        row.kind === "phase"
          ? {
              kind: "phase",
              id: phaseRowId(row.id),
              phase: phaseById.get(row.id)!,
              depth: row.depth,
              rollup: rollups[row.id]!,
              subRows: [],
              container: phaseById.get(row.id)!.parentId,
            }
          : {
              kind: "line",
              id: row.id,
              line: lineById.get(row.id)!,
              depth: row.depth,
              container: lineById.get(row.id)!.phaseId,
            }
    ),
    (row) => (row.container === null ? null : phaseRowId(row.container))
  ) as unknown as GridRow[]
  const options = phaseOptions(phases)

  // Drop selected ids that no longer exist (deleted here or elsewhere).
  const selectedIds = Object.keys(selection).filter(
    (id) => selection[id] && lineById.has(id)
  )
  const clearSelection = (ids: readonly string[]) =>
    setSelection((s) =>
      Object.fromEntries(Object.entries(s).filter(([id]) => !ids.includes(id)))
    )

  const actions: GridActions = {
    onUpdate: (patch) => commands.update.mutate({ quoteId, ...patch }),
    onDelete: (ids) => {
      commands.remove.mutate({ quoteId, ids })
      clearSelection(ids)
    },
    onMoveLines: (move) => commands.move.mutate({ quoteId, ...move }),
    onCloneLines: (clone) => commands.clone.mutate({ quoteId, ...clone }),
    onRenamePhase: (id, name) =>
      commands.renamePhase.mutate({ quoteId, id, name }),
    onMovePhase: (move) => commands.movePhase.mutate({ quoteId, ...move }),
    onDeletePhase: (id) => setDeleting(id),
    onClonePhase: (id) => commands.clonePhase.mutate({ quoteId, id }),
    onAddSubPhase: (parentId) => setNewPhaseParent({ parentId }),
    onAddItemsTo: (phaseId) => {
      setAddPhaseId(phaseId)
      setAdding(true)
    },
    onToggleCollapsed: (phaseId) =>
      setCollapsed((current) => {
        const next = new Set(current)
        if (next.has(phaseId)) next.delete(phaseId)
        else next.add(phaseId)
        return next
      }),
  }

  const openAdd = () => {
    setAddPhaseId(null)
    setAdding(true)
  }

  const sellables = (["product", "add_on", "resource_role"] as const)
    .filter((t) => labels[t].enabled)
    .map((t) => labels[t].plural)
    .join(", ")

  const deletingPhase = deleting ? phaseById.get(deleting) : undefined
  const deletingRollup = deleting ? rollups[deleting] : undefined
  const newParent = newPhaseParent?.parentId
    ? phaseById.get(newPhaseParent.parentId)
    : undefined

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {!readOnly && (
            <>
              <Button onClick={openAdd}>
                <PlusIcon data-icon="inline-start" />
                Add items
              </Button>
              <Button
                variant="outline"
                onClick={() => setNewPhaseParent({ parentId: null })}
              >
                <FolderPlusIcon data-icon="inline-start" />
                Add {phaseTerm.singular.toLowerCase()}
              </Button>
            </>
          )}
          {!readOnly && selectedIds.length > 0 && (
            <>
              <span className="ml-2 text-sm text-muted-foreground">
                {selectedIds.length} selected
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" />}>
                  <FolderInputIcon data-icon="inline-start" />
                  Move to
                </DropdownMenuTrigger>
                <DropdownMenuContent className="max-h-80 w-56 overflow-y-auto">
                  <DropdownMenuItem
                    onClick={() =>
                      commands.move.mutate({
                        quoteId,
                        ids: selectedIds,
                        phaseId: null,
                      })
                    }
                  >
                    No {phaseTerm.singular}
                  </DropdownMenuItem>
                  {options.length > 0 && <DropdownMenuSeparator />}
                  {options.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      onClick={() =>
                        commands.move.mutate({
                          quoteId,
                          ids: selectedIds,
                          phaseId: option.value,
                        })
                      }
                    >
                      {option.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="outline"
                onClick={() =>
                  commands.clone.mutate({ quoteId, ids: selectedIds })
                }
              >
                <CopyIcon data-icon="inline-start" />
                Clone
              </Button>
              <Button
                variant="outline"
                onClick={() => actions.onDelete(selectedIds)}
              >
                <Trash2Icon data-icon="inline-start" />
                Delete
              </Button>
            </>
          )}
          {phases.length > 0 && (
            <div className="ml-auto flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={collapsed.size === 0}
                onClick={() => setCollapsed(new Set())}
              >
                <ChevronsUpDownIcon data-icon="inline-start" />
                Expand all
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCollapsed(new Set(phases.map((p) => p.id)))}
              >
                <ChevronsDownUpIcon data-icon="inline-start" />
                Collapse all
              </Button>
            </div>
          )}
        </div>
        {lines.length === 0 && phases.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ListPlusIcon />
              </EmptyMedia>
              <EmptyTitle>No Line Items yet</EmptyTitle>
              <EmptyDescription>
                {readOnly
                  ? "This Quote has no Line Items."
                  : `Add ${sellables} to price this Quote, and group them into ${phaseTerm.plural.toLowerCase()}. Every change saves itself.`}
              </EmptyDescription>
            </EmptyHeader>
            {!readOnly && (
              <EmptyContent>
                <Button onClick={openAdd}>
                  <PlusIcon data-icon="inline-start" />
                  Add items
                </Button>
              </EmptyContent>
            )}
          </Empty>
        ) : (
          <LineItemsGrid
            tree={tree}
            phases={phases}
            lines={lines}
            currency={editor.totals.currencyCode}
            quoteStartDate={quote.startDate}
            quoteEndDate={quote.endDate}
            readOnly={readOnly}
            selection={selection}
            onSelectionChange={setSelection}
            collapsed={collapsed}
            actions={actions}
          />
        )}
      </div>
      {!readOnly && (
        <>
          <AddItemsSheet
            open={adding}
            onOpenChange={setAdding}
            currency={editor.totals.currencyCode}
            phaseOptions={options}
            phaseId={addPhaseId}
            onPhaseIdChange={setAddPhaseId}
            pending={commands.add.isPending}
            onAdd={({ phaseId, items }, done) =>
              commands.add.mutate(
                {
                  quoteId,
                  phaseId,
                  items: items.map(({ sourceKind, id }) => ({
                    sourceKind,
                    id,
                  })),
                },
                { onSuccess: done }
              )
            }
          />
          <PhaseDialog
            open={newPhaseParent !== null}
            onOpenChange={(open) => !open && setNewPhaseParent(null)}
            parentName={newParent?.name ?? null}
            onCreate={(name) =>
              commands.createPhase.mutateAsync({
                quoteId,
                name,
                parentId: newPhaseParent?.parentId ?? null,
              })
            }
          />
          <ConfirmDialog
            open={deletingPhase !== undefined}
            onOpenChange={(open) => !open && setDeleting(null)}
            title={`Delete “${deletingPhase?.name ?? ""}”?`}
            description={
              deletingRollup &&
              (deletingRollup.phaseCount === 0 && deletingRollup.lineCount === 0
                ? `This ${phaseTerm.singular.toLowerCase()} is empty.`
                : `This also deletes ${[
                    deletingRollup.phaseCount > 0 &&
                      plural(
                        deletingRollup.phaseCount,
                        `sub-${phaseTerm.singular.toLowerCase()}`,
                        `sub-${phaseTerm.plural.toLowerCase()}`
                      ),
                    deletingRollup.lineCount > 0 &&
                      plural(
                        deletingRollup.lineCount,
                        "Line Item",
                        "Line Items"
                      ),
                  ]
                    .filter(Boolean)
                    .join(
                      " and "
                    )} inside it. You can undo this for a few seconds.`)
            }
            onConfirm={() => {
              if (!deleting) return
              const gone = subtreeIds(phases, deleting)
              clearSelection(
                lines
                  .filter((l) => l.phaseId !== null && gone.has(l.phaseId))
                  .map((l) => l.id)
              )
              commands.removePhase.mutate({ quoteId, id: deleting })
              setDeleting(null)
            }}
          />
        </>
      )}
    </div>
  )
}
