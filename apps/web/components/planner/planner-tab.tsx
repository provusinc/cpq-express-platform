"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import {
  CalendarRangeIcon,
  EraserIcon,
  KeyboardIcon,
  PaintBucketIcon,
  PlusIcon,
} from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { periodTypeForTimePeriod } from "@workspace/domain/dates"
import type { PeriodType } from "@workspace/domain/enums"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Kbd, KbdGroup } from "@workspace/ui/components/kbd"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { Separator } from "@workspace/ui/components/separator"

import { AddItemsSheet } from "@/components/line-items/add-items-sheet"
import { useLineItemCommands } from "@/components/line-items/commands"
import {
  QuoteSaveIndicator,
  useQuoteEditor,
} from "@/components/quotes/autosave"
import type { EditorLine } from "@/components/quotes/autosave"
import { useQuote } from "@/components/quotes/use-quote"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/shell/empty"
import { useLabels } from "@/components/shell/labels"
import { useHydrated } from "@/components/shell/use-hydrated"
import { todayIsoDate } from "@/lib/format"
import { wholeMoney } from "@/lib/money"
import { phaseOptions } from "@/lib/phase-tree"
import {
  amountsByPeriod,
  bandAt,
  bucketPresets,
  currentPeriodIndex,
  fillRange,
  formatAmount,
  isPlannerLine,
  PER_PERIOD,
  phaseBands,
  plannerPeriods,
  plannerRows,
  rangeOf,
  selectionCaption,
  shownAllocations,
  sumAmounts,
} from "@/lib/planner"
import type {
  AmountByPeriod,
  CellEdit,
  CellPos,
  CellRange,
} from "@/lib/planner"
import { useTRPC } from "@/trpc/react"

import { usePlannerCommands } from "./commands"
import { parseAmount, PlannerGrid } from "./planner-grid"
import type { PlannerLineRow } from "./planner-grid"

type Selection = { anchor: CellPos; focus: CellPos }

const BUCKET_WORD: Record<PeriodType, [string, string]> = {
  week: ["week", "weeks"],
  month: ["month", "months"],
  quarter: ["quarter", "quarters"],
}

const count = (n: number, [one, many]: [string, string]) =>
  `${n.toLocaleString("en")} ${n === 1 ? one : many}`

/**
 * The Quote editor's Resource Planner tab: a header strip (title, a quiet
 * summary, the save state, the keyboard shortcuts, Add Resource Role),
 * the selection bar (what is selected and its hours, presets, a custom
 * amount, fill/clear row), then the grid at full width: the hourly Resource
 * Role Line Items by period (the Quote's bucket within its dates), grouped
 * by Phase and edited like a spreadsheet — every gesture one
 * `allocation.setRange` command, applied optimistically. Read-only when the
 * viewer can't edit the Quote. The Quote's figures stay in the header.
 */
export function PlannerTab({ quoteId }: { quoteId: string }) {
  const trpc = useTRPC()
  const quote = useQuote(quoteId)
  const editor = useQuoteEditor(quoteId)
  const labels = useLabels()
  const roleTerm = labels.resource_role
  const readOnly = !quote.permissions.canEdit
  const commands = usePlannerCommands(quoteId, quote)
  const { hoursPerDay } = useSuspenseQuery(
    trpc.settings.quoting.queryOptions()
  ).data
  const overview = useSuspenseQuery(
    trpc.quote.overview.queryOptions({ id: quoteId })
  ).data
  const hydrated = useHydrated()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [selection, setSelection] = useState<Selection | null>(null)
  const [adding, setAdding] = useState(false)
  const [addPhaseId, setAddPhaseId] = useState<string | null>(null)

  const currency = editor.totals.currencyCode
  const periodType = periodTypeForTimePeriod(quote.timePeriod)
  const periods = plannerPeriods(
    quote.timePeriod,
    quote.startDate,
    quote.endDate
  )
  const periodStarts = periods.map((p) => p.start)
  const capacity = periods.map((p) => p.workingDays * Number(hoursPerDay))
  // Today is the viewer's, so only once hydrated (the server's may differ).
  const currentCol = hydrated ? currentPeriodIndex(periods, todayIsoDate()) : -1
  const bands = phaseBands(periods, editor.phases, editor.lines)
  const phaseTints = new Map(
    editor.phases
      .filter((p) => p.parentId === null)
      .sort((a, b) => a.sequence - b.sequence)
      .map((p, i) => [p.id, (i % 5) + 1])
  )
  const phaseNames = new Map(editor.phases.map((p) => [p.id, p.name]))

  const roles = new Map(overview.resourceRoles.map((r) => [r.id, r]))
  const detailOf = (line: EditorLine) => {
    const role = line.resourceRoleId ? roles.get(line.resourceRoleId) : null
    const place = role
      ? [role.locationCity, role.locationState ?? role.locationCountry]
          .filter(Boolean)
          .join(", ")
      : ""
    return [place, `${wholeMoney(line.unitPrice, currency)}/h`]
      .filter(Boolean)
      .join(" · ")
  }

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
            detail: detailOf(r.line as EditorLine),
            values: lineValues.get(r.id)!,
            implied: !r.line.plannerManaged,
          },
        ]
      : []
  )
  const totalHours = sumAmounts(
    [...lineValues.values()].flatMap((v) => [...v.values()])
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

  const addSheet = !readOnly && (
    <AddRolesSheet
      quoteId={quoteId}
      open={adding}
      onOpenChange={setAdding}
      currency={currency}
      phases={editor.phases}
      phaseId={addPhaseId}
      onPhaseIdChange={setAddPhaseId}
    />
  )
  const openAdd = () => {
    setAddPhaseId(null)
    setAdding(true)
  }

  if (lines.length === 0) {
    return (
      <>
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarRangeIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing to plan yet</EmptyTitle>
            <EmptyDescription>
              The Resource Planner lays out the Effort of hourly{" "}
              {roleTerm.plural} period by period. Add {roleTerm.plural} to this
              Quote first.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            {!readOnly && (
              <Button onClick={openAdd}>
                <PlusIcon data-icon="inline-start" />
                Add {roleTerm.singular}
              </Button>
            )}
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href={`/quotes/${quoteId}/line-items`} />}
            >
              Go to Line Items
            </Button>
          </EmptyContent>
        </Empty>
        {addSheet}
      </>
    )
  }

  const focusPhaseId = current
    ? (bandAt(bands, current.focus.col)?.phaseId ?? null)
    : null

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-base font-medium">Resource plan</h2>
          <p className="text-sm text-muted-foreground tabular-nums">
            {count(lines.length, [roleTerm.singular, roleTerm.plural])} ·{" "}
            {count(periods.length, BUCKET_WORD[periodType])} ·{" "}
            {Number(totalHours).toLocaleString("en")} total hours
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <QuoteSaveIndicator quoteId={quoteId} />
          <KeysPopover readOnly={readOnly} />
          {!readOnly && (
            <Button variant="outline" onClick={openAdd}>
              <PlusIcon data-icon="inline-start" />
              Add {roleTerm.singular}
            </Button>
          )}
        </div>
      </div>
      <SelectionBar
        caption={
          range
            ? selectionCaption({
                range,
                rowNames: lineRows.map((r) => r.name),
                periods,
                periodType,
                rolesWord: roleTerm.plural,
                phase: focusPhaseId
                  ? (phaseNames.get(focusPhaseId) ?? null)
                  : null,
              })
            : null
        }
        line={range && range.top === range.bottom ? selectedLine : undefined}
        value={
          current && selectedLine
            ? lineValues
                .get(selectedLine.id)
                ?.get(periodStarts[current.focus.col]!)
            : undefined
        }
        range={range}
        rangeHours={
          range
            ? sumAmounts(
                fillRange(
                  range,
                  lineRows.map((r) => r.id),
                  periodStarts,
                  null
                ).map((c) => lineValues.get(c.lineItemId)?.get(c.periodStart))
              )
            : "0"
        }
        periodType={periodType}
        readOnly={readOnly}
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
        onFillSelection={(amount) => {
          if (!range) return
          const size =
            (range.bottom - range.top + 1) * (range.right - range.left + 1)
          onEdit(
            fillRange(
              range,
              lineRows.map((r) => r.id),
              periodStarts,
              amount
            ),
            amount === null && size > 1 ? "Selection cleared." : undefined
          )
        }}
        parse={(text) => parseAmount(text, periodType)}
      />
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
        bands={bands}
        capacity={capacity}
        currentCol={currentCol}
        phaseTints={phaseTints}
        roleTerm={roleTerm}
      />
      {lineRows.some((r) => r.implied) && (
        <p className="-mt-1 text-xs text-muted-foreground">
          Italic values are the default layout until you edit the row.
        </p>
      )}
      {addSheet}
    </div>
  )
}

/** The Add Items sheet opened on the Resource Roles tab. */
function AddRolesSheet({
  quoteId,
  open,
  onOpenChange,
  currency,
  phases,
  phaseId,
  onPhaseIdChange,
}: {
  quoteId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  currency: string
  phases: Parameters<typeof phaseOptions>[0]
  phaseId: string | null
  onPhaseIdChange: (phaseId: string | null) => void
}) {
  const { add } = useLineItemCommands(quoteId)
  return (
    <AddItemsSheet
      open={open}
      onOpenChange={onOpenChange}
      currency={currency}
      phaseOptions={phaseOptions(phases)}
      phaseId={phaseId}
      onPhaseIdChange={onPhaseIdChange}
      pending={add.isPending}
      initialTab="resource_role"
      onAdd={({ phaseId, items }, done) =>
        add.mutate(
          {
            quoteId,
            phaseId,
            items: items.map(({ sourceKind, id }) => ({ sourceKind, id })),
          },
          { onSuccess: done }
        )
      }
    />
  )
}

/**
 * The slim bar above the grid, its height always reserved (so the grid
 * doesn't move under the pointer): with a selection it names it (role,
 * period, Phase) with its hours, then — for an editor — presets and a
 * custom amount for the selection, and Fill this row / Clear row for a
 * one-row selection, each one `allocation.setRange`; without one a hint.
 */
function SelectionBar({
  caption,
  line,
  value,
  range,
  rangeHours,
  periodType,
  readOnly,
  onFillRow,
  onClearRow,
  onFillSelection,
  parse,
}: {
  caption: string | null
  /** The selected row, when the selection is in one row. */
  line: EditorLine | undefined
  /** The focused cell's amount. */
  value: string | undefined
  range: CellRange | null
  rangeHours: string
  periodType: PeriodType
  readOnly: boolean
  onFillRow: (line: EditorLine, amount: string | null) => void
  onClearRow: (line: EditorLine) => void
  onFillSelection: (amount: string | null) => void
  parse: (text: string) => string | null | undefined
}) {
  const [custom, setCustom] = useState("")
  const cells = range
    ? (range.bottom - range.top + 1) * (range.right - range.left + 1)
    : 0
  const shown = formatAmount(value)

  return (
    <div
      role="toolbar"
      aria-label="Selection"
      className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border bg-muted/40 px-3 py-1.5 text-sm"
    >
      {!caption ? (
        <span className="text-muted-foreground">
          {readOnly
            ? "Select cells to see their hours."
            : "Select a cell, or drag across a range, to set its hours."}
        </span>
      ) : (
        <>
          <span className="flex min-w-0 items-baseline gap-2" role="status">
            <span className="truncate font-medium" title={caption}>
              {caption}
            </span>
            <span aria-hidden className="text-muted-foreground/60">
              —
            </span>
            <span className="shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">
              <span className="figure text-base font-semibold text-foreground">
                {cells > 1 ? formatAmount(rangeHours) || "0" : shown || "0"}
              </span>{" "}
              {cells > 1 ? `hrs in ${cells} cells` : PER_PERIOD[periodType]}
            </span>
          </span>
          {!readOnly && (
            <>
              <Separator orientation="vertical" className="h-5 max-md:hidden" />
              <div className="flex items-center gap-1">
                <span className="mr-1 text-xs text-muted-foreground">
                  Set to
                </span>
                {bucketPresets(periodType).map((hours) => (
                  <Button
                    key={hours}
                    variant="outline"
                    size="xs"
                    className="min-w-8 bg-background tabular-nums"
                    aria-label={
                      hours === 0
                        ? "Clear the selection"
                        : `Set the selection to ${hours} hours`
                    }
                    onClick={() =>
                      onFillSelection(hours === 0 ? null : String(hours))
                    }
                  >
                    {hours}
                  </Button>
                ))}
                <form
                  className="ml-1 flex items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const amount = parse(custom)
                    if (amount !== undefined) onFillSelection(amount)
                  }}
                >
                  <Input
                    aria-label="Hours for every selected cell"
                    inputMode="decimal"
                    placeholder="Other"
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    className="h-6 w-16 bg-background px-2 text-right text-xs tabular-nums"
                  />
                  <Button
                    type="submit"
                    size="xs"
                    variant="outline"
                    className="bg-background"
                    disabled={!custom.trim()}
                  >
                    Fill
                  </Button>
                </form>
              </div>
              {line && (
                <>
                  <Separator
                    orientation="vertical"
                    className="h-5 max-md:hidden"
                  />
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={!shown}
                      onClick={() => onFillRow(line, shown)}
                    >
                      <PaintBucketIcon data-icon="inline-start" />
                      Fill row with {shown || "…"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={Number(line.quantity) === 0}
                      onClick={() => onClearRow(line)}
                    >
                      <EraserIcon data-icon="inline-start" />
                      Clear row
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

/** "Keyboard shortcuts": the grid's keys (shadcn `Kbd`) in a popover. */
function KeysPopover({ readOnly }: { readOnly: boolean }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="xs" className="text-muted-foreground" />
        }
      >
        <KeyboardIcon data-icon="inline-start" />
        Keyboard shortcuts
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <PopoverHeader>
          <PopoverTitle>Keyboard shortcuts</PopoverTitle>
        </PopoverHeader>
        <KeysLegend readOnly={readOnly} />
      </PopoverContent>
    </Popover>
  )
}

function KeysLegend({ readOnly }: { readOnly: boolean }) {
  const keys: [React.ReactNode, string][] = [
    [
      <KbdGroup key="arrows">
        <Kbd>←</Kbd>
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd>
        <Kbd>→</Kbd>
      </KbdGroup>,
      "Move",
    ],
    [
      <KbdGroup key="shift">
        <Kbd>⇧</Kbd>
        <span className="text-muted-foreground">+</span>
        <Kbd>←↑↓→</Kbd>
      </KbdGroup>,
      "Extend selection",
    ],
  ]
  if (!readOnly) {
    keys.push(
      [<Kbd key="digits">0–9</Kbd>, "Type hours"],
      [<Kbd key="enter">Enter</Kbd>, "Edit cell"],
      [
        <KbdGroup key="fill">
          <Kbd>⌘</Kbd>
          <Kbd>Enter</Kbd>
        </KbdGroup>,
        "Fill selection",
      ],
      [<Kbd key="backspace">⌫</Kbd>, "Clear"],
      [<Kbd key="tab">Tab</Kbd>, "Save, next cell"]
    )
  }
  return (
    <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-xs">
      {keys.map(([keysNode, label]) => (
        <div key={label} className="contents">
          <dt>{keysNode}</dt>
          <dd className="text-muted-foreground">{label}</dd>
        </div>
      ))}
    </dl>
  )
}
