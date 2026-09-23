"use client"

import { CalendarRangeIcon, EraserIcon, PaintBucketIcon } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { periodTypeForTimePeriod } from "@workspace/domain/dates"
import { TIME_PERIOD_LABELS } from "@workspace/domain/enums"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"

import { useQuoteEditor } from "@/components/quotes/autosave"
import type { EditorLine } from "@/components/quotes/autosave"
import { useQuote } from "@/components/quotes/quote-header"
import { useLabels } from "@/components/shell/labels"
import { formatDate } from "@/lib/format"
import { formatMoney, trimMoney } from "@/lib/money"
import {
  amountsByPeriod,
  fillRange,
  formatAmount,
  isPlannerLine,
  plannerPeriods,
  plannerRows,
  rangeOf,
  shownAllocations,
} from "@/lib/planner"
import type { AmountByPeriod, CellEdit, CellPos } from "@/lib/planner"

import { usePlannerCommands } from "./commands"
import { parseAmount, PlannerGrid } from "./planner-grid"
import type { PlannerLineRow } from "./planner-grid"

type Selection = { anchor: CellPos; focus: CellPos }

/**
 * The Quote editor's Resource Planner tab: the hourly Resource Role Line
 * Items by period (the Quote's bucket within its dates), grouped by Phase,
 * edited like a spreadsheet — every gesture one `allocation.setRange`
 * command, applied optimistically. Beside it, the inspector for the
 * selected row (fill row with N, clear row with Undo) and the selection
 * tools. Read-only when the viewer can't edit the Quote.
 */
export function PlannerTab({ quoteId }: { quoteId: string }) {
  const quote = useQuote(quoteId)
  const editor = useQuoteEditor(quoteId)
  const labels = useLabels()
  const readOnly = !quote.permissions.canEdit
  const commands = usePlannerCommands(quoteId, quote)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [selection, setSelection] = useState<Selection | null>(null)

  const periodType = periodTypeForTimePeriod(quote.timePeriod)
  const periods = plannerPeriods(
    quote.timePeriod,
    quote.startDate,
    quote.endDate
  )
  const periodStarts = periods.map((p) => p.start)
  const lines = editor.lines.filter(isPlannerLine)
  const lineValues = new Map<string, AmountByPeriod>(
    lines.map((l) => [
      l.id,
      amountsByPeriod(shownAllocations(l, quote.timePeriod)),
    ])
  )
  const rows = plannerRows(
    lines,
    editor.phases,
    collapsed,
    `No ${labels.phase.singular.toLowerCase()}`
  )
  const lineRows: PlannerLineRow[] = rows.flatMap((r) =>
    r.kind === "line"
      ? [
          {
            id: r.id,
            name: r.line.name,
            values: lineValues.get(r.id)!,
            implied: !r.line.plannerManaged,
          },
        ]
      : []
  )

  // Keep the selection inside the grid as rows come and go.
  const clampPos = (p: CellPos): CellPos => ({
    row: Math.min(p.row, lineRows.length - 1),
    col: Math.min(p.col, periods.length - 1),
  })
  const current =
    selection && lineRows.length > 0 && periods.length > 0
      ? { anchor: clampPos(selection.anchor), focus: clampPos(selection.focus) }
      : null
  const range = current ? rangeOf(current.anchor, current.focus) : null
  const rangeSize = range
    ? (range.bottom - range.top + 1) * (range.right - range.left + 1)
    : 0
  const selectedLine: EditorLine | undefined = current
    ? lines.find((l) => l.id === lineRows[current.focus.row]?.id)
    : undefined

  const onEdit = (cells: CellEdit[], undoMessage?: string) =>
    commands.setRange(cells, { undoMessage })

  const toggle = (id: string) =>
    setCollapsed((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (lines.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarRangeIcon />
          </EmptyMedia>
          <EmptyTitle>Nothing to plan yet</EmptyTitle>
          <EmptyDescription>
            The Resource Planner lays out the Effort of hourly{" "}
            {labels.resource_role.plural} period by period. Add{" "}
            {labels.resource_role.plural} to this Quote first.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={`/quotes/${quoteId}`} />}
          >
            Go to Line Items
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            Hours per {periodType} · {TIME_PERIOD_LABELS[quote.timePeriod]} ·{" "}
            {formatDate(quote.startDate)} – {formatDate(quote.endDate)}
          </span>
          {!readOnly && range && (
            <SelectionTools
              key={`${range.top}:${range.left}:${range.bottom}:${range.right}`}
              count={rangeSize}
              onFill={(amount) =>
                onEdit(
                  fillRange(
                    range,
                    lineRows.map((r) => r.id),
                    periodStarts,
                    amount
                  )
                )
              }
              onClear={() =>
                onEdit(
                  fillRange(
                    range,
                    lineRows.map((r) => r.id),
                    periodStarts,
                    null
                  ),
                  rangeSize > 1 ? "Selection cleared." : undefined
                )
              }
              parse={(text) => parseAmount(text, periodType)}
            />
          )}
        </div>
        <PlannerGrid
          rows={rows}
          lineRows={lineRows}
          lineValues={lineValues}
          periods={periods}
          periodType={periodType}
          readOnly={readOnly}
          selection={current}
          onSelectionChange={setSelection}
          onEdit={(cells) => onEdit(cells)}
          onToggle={toggle}
          hint={
            <p className="text-xs text-muted-foreground">
              {readOnly
                ? "Read only."
                : "Type to edit a cell · drag, Shift+click or Shift+arrows to select · Ctrl/⌘+Enter fills the selection · drag the corner handle to fill · Delete clears. Italic values are the default layout until you edit the row."}
            </p>
          }
        />
      </div>
      <Inspector
        key={selectedLine?.id ?? "none"}
        line={selectedLine}
        currency={editor.totals.currencyCode}
        quoteTotal={editor.totals.total}
        readOnly={readOnly}
        roleLabel={labels.resource_role.singular}
        onFillRow={(line, amount) =>
          onEdit(
            periodStarts.map((periodStart) => ({
              lineItemId: line.id,
              periodStart,
              amount,
            }))
          )
        }
        onClearRow={(line) =>
          onEdit(
            [...(lineValues.get(line.id)?.keys() ?? [])].map((periodStart) => ({
              lineItemId: line.id,
              periodStart,
              amount: null,
            })),
            `${line.name} cleared.`
          )
        }
        parse={(text) => parseAmount(text, periodType)}
      />
    </div>
  )
}

/** Fill or clear the selected range. */
function SelectionTools({
  count,
  onFill,
  onClear,
  parse,
}: {
  count: number
  onFill: (amount: string | null) => void
  onClear: () => void
  parse: (text: string) => string | null | undefined
}) {
  const [value, setValue] = useState("")
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        const amount = parse(value)
        if (amount !== undefined) onFill(amount)
      }}
    >
      <span>
        {count} {count === 1 ? "cell" : "cells"}
      </span>
      <Input
        aria-label="Hours for every selected cell"
        inputMode="decimal"
        placeholder="Hours"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-7 w-20 text-right"
      />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={!value.trim()}
      >
        <PaintBucketIcon data-icon="inline-start" />
        Fill selection
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onClear}>
        <EraserIcon data-icon="inline-start" />
        Clear
      </Button>
    </form>
  )
}

/** The selected row: its figures, "fill row with N" and "clear row". */
function Inspector({
  line,
  currency,
  quoteTotal,
  readOnly,
  roleLabel,
  onFillRow,
  onClearRow,
  parse,
}: {
  line: EditorLine | undefined
  currency: string
  quoteTotal: string
  readOnly: boolean
  roleLabel: string
  onFillRow: (line: EditorLine, amount: string | null) => void
  onClearRow: (line: EditorLine) => void
  parse: (text: string) => string | null | undefined
}) {
  const [value, setValue] = useState("")
  return (
    <Card className="w-full shrink-0 xl:sticky xl:top-4 xl:w-72" size="sm">
      <CardHeader>
        <CardTitle className="truncate">
          {line?.name ?? "No row selected"}
        </CardTitle>
        <CardDescription>
          {line ? roleLabel : "Select a cell to inspect its row."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {line && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Dates</dt>
            <dd className="text-right">
              {formatDate(line.startDate)} – {formatDate(line.endDate)}
            </dd>
            <dt className="text-muted-foreground">Effort</dt>
            <dd className="text-right tabular-nums">
              {formatAmount(line.quantity) || "0"} h
            </dd>
            <dt className="text-muted-foreground">Rate</dt>
            <dd className="text-right tabular-nums">
              {formatMoney(line.unitPrice, currency)} / h
            </dd>
            <dt className="text-muted-foreground">Line total</dt>
            <dd className="text-right font-medium tabular-nums">
              {formatMoney(line.lineTotal, currency)}
            </dd>
            <dt className="text-muted-foreground">Margin</dt>
            <dd className="text-right tabular-nums">
              {trimMoney(line.lineMarginPct)}%
            </dd>
          </dl>
        )}
        {line && !readOnly && (
          <div className="flex flex-col gap-2">
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                const amount = parse(value)
                if (amount !== undefined) onFillRow(line, amount)
              }}
            >
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="planner-fill-row">Fill row with</Label>
                <Input
                  id="planner-fill-row"
                  inputMode="decimal"
                  placeholder="Hours per period"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </div>
              <Button type="submit" variant="outline" disabled={!value.trim()}>
                Fill
              </Button>
            </form>
            <Button
              variant="outline"
              disabled={Number(line.quantity) === 0}
              onClick={() => onClearRow(line)}
            >
              <EraserIcon data-icon="inline-start" />
              Clear row
            </Button>
          </div>
        )}
        <div className="flex items-baseline justify-between border-t pt-3 text-sm">
          <span className="text-muted-foreground">Quote Total</span>
          <span className="font-semibold tabular-nums">
            {formatMoney(quoteTotal, currency)}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
