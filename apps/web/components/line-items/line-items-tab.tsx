"use client"

import type { RowSelectionState } from "@tanstack/react-table"
import { ListPlusIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { useQuoteEditor } from "@/components/quotes/autosave"
import { useQuote } from "@/components/quotes/quote-header"
import { useLabels } from "@/components/shell/labels"

import { AddItemsSheet } from "./add-items-sheet"
import { useLineItemCommands } from "./commands"
import { LineItemsGrid } from "./line-items-grid"
import type { LineItemPatch } from "./line-items-grid"
import { QuoteSummary } from "./quote-summary"

/**
 * The Quote editor's Line Items tab: the grid with inline autosaving
 * edits, bulk delete with undo, the Add Items sheet and the Summary with
 * the Quote Discount. Read-only (no add, edit or delete) when the Quote is
 * locked or the viewer may not edit it; the server refuses regardless.
 */
export function LineItemsTab({ quoteId }: { quoteId: string }) {
  const quote = useQuote(quoteId)
  const editor = useQuoteEditor(quoteId)
  const labels = useLabels()
  const commands = useLineItemCommands(quoteId)
  const readOnly = !quote.permissions.canEdit
  const [adding, setAdding] = useState(false)
  const [selection, setSelection] = useState<RowSelectionState>({})

  // Drop selected ids that no longer exist (deleted here or elsewhere).
  const selectedIds = Object.keys(selection).filter(
    (id) => selection[id] && editor.lines.some((l) => l.id === id)
  )

  const onUpdate = (patch: LineItemPatch) =>
    commands.update.mutate({ quoteId, ...patch })
  const onDelete = (ids: string[]) => {
    commands.remove.mutate({ quoteId, ids })
    setSelection((s) =>
      Object.fromEntries(Object.entries(s).filter(([id]) => !ids.includes(id)))
    )
  }

  const sellables = (["product", "add_on", "resource_role"] as const)
    .filter((t) => labels[t].enabled)
    .map((t) => labels[t].plural)
    .join(", ")

  return (
    <div className="flex min-w-0 flex-col gap-4 2xl:flex-row 2xl:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setAdding(true)}>
              <PlusIcon data-icon="inline-start" />
              Add items
            </Button>
            {selectedIds.length > 0 && (
              <Button variant="outline" onClick={() => onDelete(selectedIds)}>
                <Trash2Icon data-icon="inline-start" />
                Delete {selectedIds.length} selected
              </Button>
            )}
          </div>
        )}
        {editor.lines.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ListPlusIcon />
              </EmptyMedia>
              <EmptyTitle>No Line Items yet</EmptyTitle>
              <EmptyDescription>
                {readOnly
                  ? "This Quote has no Line Items."
                  : `Add ${sellables} to price this Quote. Every change saves itself.`}
              </EmptyDescription>
            </EmptyHeader>
            {!readOnly && (
              <EmptyContent>
                <Button onClick={() => setAdding(true)}>
                  <PlusIcon data-icon="inline-start" />
                  Add items
                </Button>
              </EmptyContent>
            )}
          </Empty>
        ) : (
          <LineItemsGrid
            lines={editor.lines}
            currency={editor.totals.currencyCode}
            quoteStartDate={quote.startDate}
            quoteEndDate={quote.endDate}
            readOnly={readOnly}
            selection={selection}
            onSelectionChange={setSelection}
            onUpdate={onUpdate}
            onDelete={onDelete}
          />
        )}
      </div>
      <QuoteSummary
        totals={editor.totals}
        readOnly={readOnly}
        onSetDiscount={(discount) =>
          commands.setDiscount.mutate({ id: quoteId, discount })
        }
      />
      {!readOnly && (
        <AddItemsSheet
          open={adding}
          onOpenChange={setAdding}
          currency={editor.totals.currencyCode}
          phases={editor.phases}
          pending={commands.add.isPending}
          onAdd={({ phaseId, items }, done) =>
            commands.add.mutate(
              {
                quoteId,
                phaseId,
                items: items.map(({ sourceKind, id }) => ({ sourceKind, id })),
              },
              { onSuccess: done }
            )
          }
        />
      )}
    </div>
  )
}
