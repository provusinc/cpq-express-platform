"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import {
  CalendarRangeIcon,
  EraserIcon,
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
import { Separator } from "@workspace/ui/components/separator"
import { cn } from "@workspace/ui/lib/utils"

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
import { formatDate, todayIsoDate } from "@/lib/format"
import { formatMoney, trimMoney, wholeMoney } from "@/lib/money"
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
  shownAllocations,
  sumAmounts,
} from "@/lib/planner"
import type {
  AmountByPeriod,
  CellEdit,
  CellPos,
  CellRange,
  PlannerPeriod,
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
 * summary, the save state, Add Resource Role), then the hourly Resource
 * Role Line Items by period (the Quote's bucket within its dates), grouped
 * by Phase and edited like a spreadsheet — every gesture one
 * `allocation.setRange` command, applied optimistically — beside the
 * sticky inspector for the selected cell (its role and period, the value,
 * fill/clear row, presets for the selection, the keys). Read-only when the
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

  const focusPeriod = current ? periods[current.focus.col] : undefined
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
          {!readOnly && (
            <Button variant="outline" onClick={openAdd}>
              <PlusIcon data-icon="inline-start" />
              Add {roleTerm.singular}
            </Button>
          )}
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
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
            <p className="text-xs text-muted-foreground">
              Italic values are the default layout until you edit the row.
            </p>
          )}
        </div>
        <Inspector
          key={selectedLine?.id ?? "none"}
          line={selectedLine}
          detail={selectedLine ? detailOf(selectedLine) : ""}
          period={focusPeriod}
          periodPhase={
            focusPhaseId ? (phaseNames.get(focusPhaseId) ?? null) : null
          }
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
          currency={currency}
          readOnly={readOnly}
          roleLabel={roleTerm.singular}
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
              [...(lineValues.get(line.id)?.keys() ?? [])].map(
                (periodStart) => ({
                  lineItemId: line.id,
                  periodStart,
                  amount: null,
                })
              ),
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
      </div>
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
 * The selected cell: its role (with location and rate) and period (with
 * its Phase), the value large (or the selection's size and hours), then
 * fill / clear the row, presets and a custom amount for the selection (one
 * command each), and the keyboard legend.
 */
function Inspector({
  line,
  detail,
  period,
  periodPhase,
  value,
  range,
  rangeHours,
  periodType,
  currency,
  readOnly,
  roleLabel,
  onFillRow,
  onClearRow,
  onFillSelection,
  parse,
}: {
  line: EditorLine | undefined
  detail: string
  period: PlannerPeriod | undefined
  periodPhase: string | null
  value: string | undefined
  range: CellRange | null
  rangeHours: string
  periodType: PeriodType
  currency: string
  readOnly: boolean
  roleLabel: string
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
  const unit = PER_PERIOD[periodType]

  return (
    <aside
      aria-label="Selected cell"
      className="flex w-full shrink-0 flex-col rounded-lg border bg-card text-sm xl:sticky xl:top-28 xl:w-72"
    >
      {!line || !period ? (
        <p className="p-4 text-muted-foreground">
          Select a cell to see its {roleLabel} and period, and to fill it.
        </p>
      ) : (
        <>
          <section className="flex flex-col gap-3 p-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Selected</span>
              <span
                className="truncate text-base font-medium"
                title={line.name}
              >
                {line.name}
              </span>
              {detail && (
                <span className="truncate text-xs text-muted-foreground">
                  {detail}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Period</span>
              <span className="tabular-nums">
                {period.title}
                {periodPhase && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {periodPhase}
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-baseline gap-1.5" role="status">
              {cells > 1 ? (
                <>
                  <span className="figure text-3xl leading-none font-semibold">
                    {formatAmount(rangeHours) || "0"}
                  </span>
                  <span className="text-muted-foreground">
                    hrs in {cells} cells
                  </span>
                </>
              ) : (
                <>
                  <span
                    className={cn(
                      "figure text-3xl leading-none font-semibold",
                      !shown && "text-muted-foreground"
                    )}
                  >
                    {shown || "0"}
                  </span>
                  <span className="text-muted-foreground">{unit}</span>
                </>
              )}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Dates</dt>
              <dd className="text-right">
                {formatDate(line.startDate)} – {formatDate(line.endDate)}
              </dd>
              <dt className="text-muted-foreground">Effort</dt>
              <dd className="text-right tabular-nums">
                {formatAmount(line.quantity) || "0"} h ·{" "}
                {formatMoney(line.lineTotal, currency)} ·{" "}
                {trimMoney(line.lineMarginPct)}% margin
              </dd>
            </dl>
          </section>
          {!readOnly && (
            <>
              <Separator />
              <section className="flex flex-col gap-2 p-4">
                <span className="text-xs text-muted-foreground">
                  Quick actions
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-start"
                  disabled={!shown}
                  onClick={() => onFillRow(line, shown)}
                >
                  <PaintBucketIcon data-icon="inline-start" />
                  Fill this row with {shown || "…"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-start"
                  disabled={Number(line.quantity) === 0}
                  onClick={() => onClearRow(line)}
                >
                  <EraserIcon data-icon="inline-start" />
                  Clear row
                </Button>
              </section>
              <Separator />
              <section className="flex flex-col gap-2 p-4">
                <span className="text-xs text-muted-foreground">
                  Set {cells === 1 ? "this cell" : `${cells} cells`} to
                </span>
                <div className="grid grid-cols-6 gap-1">
                  {bucketPresets(periodType).map((hours) => (
                    <Button
                      key={hours}
                      variant="secondary"
                      size="xs"
                      className="px-0 tabular-nums"
                      onClick={() =>
                        onFillSelection(hours === 0 ? null : String(hours))
                      }
                    >
                      {hours}
                    </Button>
                  ))}
                </div>
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const amount = parse(custom)
                    if (amount !== undefined) onFillSelection(amount)
                  }}
                >
                  <Input
                    aria-label="Hours for every selected cell"
                    inputMode="decimal"
                    placeholder="Other hours"
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    className="h-7 flex-1 text-right tabular-nums"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    disabled={!custom.trim()}
                  >
                    Fill
                  </Button>
                </form>
              </section>
            </>
          )}
        </>
      )}
      <Separator />
      <KeysLegend readOnly={readOnly} />
    </aside>
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
    <section className="flex flex-col gap-2 p-4">
      <span className="text-xs text-muted-foreground">Keys</span>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-xs">
        {keys.map(([keysNode, label]) => (
          <div key={label} className="contents">
            <dt>{keysNode}</dt>
            <dd className="text-muted-foreground">{label}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
