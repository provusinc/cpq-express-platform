"use client"

import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { memo, useEffect, useEffectEvent, useRef, useState } from "react"
import { toast } from "sonner"

import { checkAllocationAmount } from "@workspace/domain/allocations"
import type { PeriodType } from "@workspace/domain/enums"
import { cn } from "@workspace/ui/lib/utils"

import { PHASE_TINT_CLASSES } from "@/components/shell/tints"
import {
  dragFillEdits,
  dragFillRange,
  fillRange,
  formatAmount,
  heatLevel,
  inRange,
  movePos,
  rangeOf,
  sumAmounts,
} from "@/lib/planner"
import type {
  AmountByPeriod,
  CellEdit,
  CellPos,
  CellRange,
  PhaseBand,
  PlannerPeriod,
  PlannerRow,
} from "@/lib/planner"

/** A cell amount as typed: digits with up to 3 decimals, or blank to clear. */
const AMOUNT_INPUT = /^\d{0,15}(\.\d{0,3})?$/

/** What one visible line row shows. */
export interface PlannerLineRow {
  id: string
  name: string
  /** Location and bill rate, e.g. "Chicago, Illinois · $185/h". */
  detail: string
  /** Allocations as shown (stored, or the default layout while not planner-managed). */
  values: AmountByPeriod
  /** Not planner-managed yet: the values are the default layout. */
  implied: boolean
}

/**
 * Validates a typed amount for a cell: a number within the bucket's cap.
 * Returns the amount to send (`null` clears) or undefined after a toast.
 */
export function parseAmount(
  text: string,
  periodType: PeriodType
): string | null | undefined {
  const value = text.trim()
  if (value === "" || /^0*(\.0*)?$/.test(value)) return null
  if (!AMOUNT_INPUT.test(value) || value === ".") {
    toast.error("Enter hours as a number with up to 3 decimals.")
    return undefined
  }
  const check = checkAllocationAmount(value, periodType, "hour")
  if (!check.ok) {
    toast.error(check.message)
    return undefined
  }
  return value
}

interface Editing {
  pos: CellPos
  text: string
}

/**
 * The Resource Planner's spreadsheet: one row per hourly Resource Role
 * Line Item (its name, and its location and bill rate beneath), under
 * Phase group rows that expand and collapse (tint dot, count, subtotals),
 * one centred column per period (label and first day, today's period
 * highlighted; the top-level Phase bands above them), a sticky Total
 * column and the period totals in the footer. Cells take a heat tint for
 * their share of the period's capacity.
 *
 * Gestures, each sent as one `onEdit(cells)` batch:
 * - type into a cell (or Enter / F2 / double-click to edit); Enter saves
 *   and moves down, Tab right, Escape cancels; Ctrl/⌘+Enter fills the
 *   whole selection with what you typed;
 * - select a range by dragging, Shift+click or Shift+arrows;
 * - Delete / Backspace clears the selection;
 * - drag the fill handle (bottom-right of the selection) to repeat the
 *   selection's values across or down.
 */
export function PlannerGrid({
  rows,
  lineRows,
  lineValues,
  periods,
  periodType,
  readOnly,
  selection,
  onSelectionChange,
  onEdit,
  onToggle,
  bands,
  capacity,
  currentCol,
  phaseTints,
  roleTerm,
}: {
  rows: PlannerRow[]
  /** The visible line rows, in display order (the selection indexes these). */
  lineRows: PlannerLineRow[]
  /** Every planner line's values, collapsed ones included (for totals). */
  lineValues: ReadonlyMap<string, AmountByPeriod>
  periods: PlannerPeriod[]
  periodType: PeriodType
  readOnly: boolean
  selection: { anchor: CellPos; focus: CellPos } | null
  onSelectionChange: (
    selection: { anchor: CellPos; focus: CellPos } | null
  ) => void
  onEdit: (cells: CellEdit[]) => void
  onToggle: (phaseId: string) => void
  /** The top-level Phase band over the periods (none: no band row). */
  bands: readonly PhaseBand[]
  /** Each period's capacity in hours (working days × Hours Per Day). */
  capacity: readonly number[]
  /** The period holding today, or -1. */
  currentCol: number
  /** Tint (1 … 5) of each top-level Phase by id. */
  phaseTints: ReadonlyMap<string, number>
  /** The Resource Role term (Label Override), singular and plural. */
  roleTerm: { singular: string; plural: string }
}) {
  const [editing, setEditing] = useState<Editing | null>(null)
  const [drag, setDrag] = useState<"select" | "fill" | null>(null)
  const [fillTarget, setFillTarget] = useState<CellPos | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  // Set once an edit is saved or cancelled, so a blur that follows the
  // Enter / Escape doesn't save it again.
  const editDone = useRef(true)

  const lineIds = lineRows.map((r) => r.id)
  const periodStarts = periods.map((p) => p.start)
  const rowIndex = new Map(lineIds.map((id, i) => [id, i]))
  const range = selection ? rangeOf(selection.anchor, selection.focus) : null
  const fillRangePreview =
    drag === "fill" && range && fillTarget
      ? dragFillRange(range, fillTarget)
      : null

  const valueAt = (row: number, col: number) => {
    const line = lineRows[row]
    const period = periods[col]
    return line && period ? line.values.get(period.start) : undefined
  }

  // Finish a drag anywhere on the page.
  const finishDrag = useEffectEvent(() => {
    if (drag === "fill" && range && fillRangePreview) {
      onEdit(
        dragFillEdits(range, fillRangePreview, lineIds, periodStarts, valueAt)
      )
      onSelectionChange({
        anchor: { row: fillRangePreview.top, col: fillRangePreview.left },
        focus: { row: fillRangePreview.bottom, col: fillRangePreview.right },
      })
    }
    setDrag(null)
    setFillTarget(null)
  })
  useEffect(() => {
    if (!drag) return
    const up = () => finishDrag()
    window.addEventListener("mouseup", up)
    return () => window.removeEventListener("mouseup", up)
  }, [drag])

  const select = (anchor: CellPos, focus: CellPos = anchor) =>
    onSelectionChange({ anchor, focus })

  const commit = (edit: Editing, { fill = false } = {}) => {
    setEditing(null)
    if (editDone.current) return
    editDone.current = true
    const amount = parseAmount(edit.text, periodType)
    if (amount === undefined) return
    const target: CellRange =
      fill && range
        ? range
        : {
            top: edit.pos.row,
            bottom: edit.pos.row,
            left: edit.pos.col,
            right: edit.pos.col,
          }
    const cells = fillRange(target, lineIds, periodStarts, amount).filter(
      (c) => {
        // Skip cells that wouldn't change.
        const current = lineRows[rowIndex.get(c.lineItemId)!]!.values.get(
          c.periodStart
        )
        return formatAmount(current) !== formatAmount(c.amount ?? undefined)
      }
    )
    onEdit(cells)
  }

  const startEditing = (pos: CellPos, text?: string) => {
    if (readOnly) return
    editDone.current = false
    setEditing({ pos, text: text ?? formatAmount(valueAt(pos.row, pos.col)) })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (editing || !selection) return
    const rowsCount = lineRows.length
    const colsCount = periods.length
    const move = (dRow: number, dCol: number) => {
      e.preventDefault()
      const focus = movePos(selection.focus, dRow, dCol, rowsCount, colsCount)
      if (e.shiftKey) select(selection.anchor, focus)
      else select(focus)
    }
    switch (e.key) {
      case "ArrowUp":
        return move(-1, 0)
      case "ArrowDown":
        return move(1, 0)
      case "ArrowLeft":
        return move(0, -1)
      case "ArrowRight":
        return move(0, 1)
      case "Enter":
      case "F2":
        e.preventDefault()
        return startEditing(selection.focus)
      case "Escape":
        return select(selection.focus)
      case "Delete":
      case "Backspace":
        e.preventDefault()
        if (readOnly || !range) return
        return onEdit(
          fillRange(range, lineIds, periodStarts, null).filter((c) =>
            Boolean(
              formatAmount(
                lineRows[rowIndex.get(c.lineItemId)!]!.values.get(c.periodStart)
              )
            )
          )
        )
    }
    if (/^[\d.]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      startEditing(selection.focus, e.key)
    }
  }

  const onCellMouseDown = (e: React.MouseEvent, pos: CellPos) => {
    if (e.button !== 0) return
    e.preventDefault()
    gridRef.current?.focus({ preventScroll: true })
    if (editing) commit(editing)
    if (e.shiftKey && selection) select(selection.anchor, pos)
    else select(pos)
    setDrag("select")
  }

  const onCellMouseEnter = (pos: CellPos) => {
    if (drag === "select" && selection) select(selection.anchor, pos)
    else if (drag === "fill") setFillTarget(pos)
  }

  const onFillHandleDown = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDrag("fill")
  }

  // Totals over every planner line, collapsed ones included.
  const allIds = [...lineValues.keys()]
  const periodTotal = (start: string, ids: readonly string[] = allIds) =>
    sumAmounts(ids.map((id) => lineValues.get(id)?.get(start)))
  const lineTotal = (id: string) =>
    sumAmounts(lineValues.get(id)?.values() ?? [])

  const hasBands = bands.length > 0
  const bandCells: React.ReactNode[] = []
  for (let col = 0; col < periods.length; ) {
    const band = bands.find((b) => b.start === col)
    if (band) {
      bandCells.push(
        <th
          key={band.phaseId + col}
          colSpan={band.span}
          scope="colgroup"
          className="border-b px-0.5 pt-1.5 pb-1 font-normal"
        >
          <div
            className={cn(
              "truncate rounded-sm px-2 py-0.5 text-left text-xs font-medium",
              PHASE_TINT_CLASSES[band.tint]?.fill
            )}
            title={band.name}
          >
            {band.name}
          </div>
        </th>
      )
      col += band.span
    } else {
      bandCells.push(<th key={`gap-${col}`} className="border-b" />)
      col++
    }
  }

  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label="Resource Planner"
      aria-readonly={readOnly}
      aria-rowcount={lineRows.length}
      aria-colcount={periods.length}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={() => {
        if (!selection && lineRows.length > 0) select({ row: 0, col: 0 })
      }}
      className="max-h-[calc(100svh-12rem)] overflow-auto rounded-lg border bg-background outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-20 bg-muted text-xs text-muted-foreground">
          {hasBands && (
            <tr>
              <th
                rowSpan={2}
                className="sticky left-0 z-30 min-w-52 border-r border-b bg-muted px-3 text-left align-bottom font-medium"
              >
                <span className="block pb-2">{roleTerm.singular}</span>
              </th>
              {bandCells}
              <th
                rowSpan={2}
                className="sticky right-0 z-30 min-w-20 border-b border-l bg-muted px-3 pb-2 text-right align-bottom font-medium"
              >
                Total
              </th>
            </tr>
          )}
          <tr>
            {!hasBands && (
              <th className="sticky left-0 z-30 h-11 min-w-52 border-r border-b bg-muted px-3 text-left font-medium">
                {roleTerm.singular}
              </th>
            )}
            {periods.map((p, col) => (
              <th
                key={p.start}
                scope="col"
                title={p.title}
                aria-current={col === currentCol ? "date" : undefined}
                className={cn(
                  "h-11 min-w-11 border-b px-1 text-center font-medium text-foreground tabular-nums",
                  col === currentCol &&
                    "bg-accent text-accent-foreground shadow-[inset_0_-2px_0_0_var(--color-primary)]"
                )}
              >
                <div className="leading-4">{p.label}</div>
                <div className="text-[11px] leading-4 font-normal text-muted-foreground">
                  {p.sublabel}
                </div>
              </th>
            ))}
            {!hasBands && (
              <th className="sticky right-0 z-30 h-11 min-w-20 border-b border-l bg-muted px-3 text-right font-medium">
                Total
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            if (row.kind === "phase") {
              const tint = phaseTints.get(row.id)
              const count = row.lineIds.length
              return (
                <tr key={`phase-${row.id}`} className="bg-muted/50">
                  <th
                    scope="row"
                    className={cn(
                      "sticky left-0 z-10 h-9 border-r border-b bg-muted px-2 text-left font-medium",
                      tint && PHASE_TINT_CLASSES[tint]?.edge
                    )}
                    style={{ paddingLeft: 6 + row.depth * 16 }}
                  >
                    <button
                      type="button"
                      className="flex w-full items-center gap-1.5 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      aria-expanded={!row.collapsed}
                      onClick={() => onToggle(row.id)}
                    >
                      {row.collapsed ? (
                        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      {tint && (
                        <span
                          aria-hidden
                          className={cn(
                            "size-2.5 shrink-0 rounded-full",
                            PHASE_TINT_CLASSES[tint]?.dot
                          )}
                        />
                      )}
                      <span className="truncate">{row.name}</span>
                      <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">
                        {count}{" "}
                        {count === 1 ? roleTerm.singular : roleTerm.plural}
                      </span>
                    </button>
                  </th>
                  {periods.map((p) => (
                    <td
                      key={p.start}
                      className="border-b px-1 text-center text-xs text-muted-foreground tabular-nums"
                    >
                      {formatAmount(periodTotal(p.start, row.lineIds))}
                    </td>
                  ))}
                  <td className="sticky right-0 z-10 border-b border-l bg-muted px-3 text-right font-semibold tabular-nums">
                    {formatAmount(sumAmounts(row.lineIds.map(lineTotal))) ||
                      "0"}
                  </td>
                </tr>
              )
            }
            const index = rowIndex.get(row.id)!
            const line = lineRows[index]!
            return (
              <tr key={row.id}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 max-w-72 border-r border-b bg-background px-3 py-1 text-left font-normal"
                  style={{ paddingLeft: 12 + row.depth * 16 }}
                  title={`${line.name}${line.detail ? ` · ${line.detail}` : ""}`}
                  onMouseDown={(e) => {
                    // Selects the whole row (Shift extends over rows).
                    if (e.button !== 0 || periods.length === 0) return
                    e.preventDefault()
                    gridRef.current?.focus({ preventScroll: true })
                    const last = periods.length - 1
                    if (e.shiftKey && selection) {
                      select(
                        { row: selection.anchor.row, col: 0 },
                        { row: index, col: last }
                      )
                    } else {
                      select({ row: index, col: 0 }, { row: index, col: last })
                    }
                  }}
                >
                  <div className="truncate font-medium">{line.name}</div>
                  {line.detail && (
                    <div className="truncate text-xs text-muted-foreground">
                      {line.detail}
                    </div>
                  )}
                </th>
                {periods.map((p, col) => {
                  const active =
                    selection?.focus.row === index &&
                    selection.focus.col === col
                  const isEditing =
                    editing?.pos.row === index && editing.pos.col === col
                  const showHandle =
                    !readOnly &&
                    !editing &&
                    range !== null &&
                    range.bottom === index &&
                    range.right === col
                  const value = line.values.get(p.start)
                  const selected = inRange(range, index, col)
                  return (
                    <PlannerCell
                      key={p.start}
                      row={index}
                      col={col}
                      value={value}
                      heat={heatLevel(value, capacity[col] ?? 0)}
                      implied={line.implied}
                      selected={selected}
                      edges={
                        selected && range
                          ? (range.top === index ? 1 : 0) |
                            (range.right === col ? 2 : 0) |
                            (range.bottom === index ? 4 : 0) |
                            (range.left === col ? 8 : 0)
                          : 0
                      }
                      active={active}
                      current={col === currentCol}
                      fillPreview={
                        fillRangePreview !== null &&
                        inRange(fillRangePreview, index, col) &&
                        !inRange(range, index, col)
                      }
                      showHandle={showHandle}
                      editing={isEditing ? editing : null}
                      onMouseDown={onCellMouseDown}
                      onMouseEnter={onCellMouseEnter}
                      onDoubleClick={startEditing}
                      onFillHandleDown={onFillHandleDown}
                      onDraftChange={(text) =>
                        setEditing((e) => (e ? { ...e, text } : e))
                      }
                      onCommit={(fill, move) => {
                        if (!editing) return
                        commit(editing, { fill })
                        gridRef.current?.focus({ preventScroll: true })
                        if (move) {
                          select(
                            movePos(
                              editing.pos,
                              move[0],
                              move[1],
                              lineRows.length,
                              periods.length
                            )
                          )
                        }
                      }}
                      onCancel={() => {
                        editDone.current = true
                        setEditing(null)
                        gridRef.current?.focus({ preventScroll: true })
                      }}
                    />
                  )
                })}
                <td className="sticky right-0 z-10 border-b border-l bg-background px-3 text-right font-medium tabular-nums">
                  {formatAmount(sumAmounts(line.values.values())) || "0"}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot className="sticky bottom-0 z-20 bg-muted">
          <tr>
            <th
              scope="row"
              className="sticky left-0 z-30 h-10 border-t border-r bg-muted px-3 text-left font-medium"
            >
              Total hours
            </th>
            {periods.map((p) => (
              <td
                key={p.start}
                className="border-t px-1 text-center text-xs font-medium tabular-nums"
              >
                {formatAmount(periodTotal(p.start))}
              </td>
            ))}
            <td className="sticky right-0 z-30 border-t border-l bg-muted px-3 text-right font-semibold tabular-nums">
              {formatAmount(sumAmounts(allIds.map(lineTotal))) || "0"}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

/**
 * A cell's heat fill by level (`heatLevel`): petrol in opacity steps up to
 * the period's capacity, warning above it. Text stays `foreground`.
 */
const HEAT: Record<number, string> = {
  0: "",
  1: "bg-primary/6",
  2: "bg-primary/12",
  3: "bg-primary/20",
  4: "bg-primary/30",
  5: "bg-warning/35",
}

/** The selection's outline on the range's outer edges (top, right, bottom, left bits). */
function edgeShadow(edges: number) {
  const parts = [
    edges & 1 && "inset 0 2px 0 0 var(--color-primary)",
    edges & 2 && "inset -2px 0 0 0 var(--color-primary)",
    edges & 4 && "inset 0 -2px 0 0 var(--color-primary)",
    edges & 8 && "inset 2px 0 0 0 var(--color-primary)",
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(", ") : undefined
}

const PlannerCell = memo(function PlannerCell({
  row,
  col,
  value,
  heat,
  implied,
  selected,
  edges,
  active,
  current,
  fillPreview,
  showHandle,
  editing,
  onMouseDown,
  onMouseEnter,
  onDoubleClick,
  onFillHandleDown,
  onDraftChange,
  onCommit,
  onCancel,
}: {
  row: number
  col: number
  value: string | undefined
  /** 0 … HEAT_LEVELS, see `heatLevel`. */
  heat: number
  implied: boolean
  selected: boolean
  /** Which outer edges of the selection this cell is on (bits: top, right, bottom, left). */
  edges: number
  active: boolean
  /** In the period holding today. */
  current: boolean
  fillPreview: boolean
  showHandle: boolean
  editing: Editing | null
  onMouseDown: (e: React.MouseEvent, pos: CellPos) => void
  onMouseEnter: (pos: CellPos) => void
  onDoubleClick: (pos: CellPos) => void
  onFillHandleDown: (e: React.MouseEvent) => void
  onDraftChange: (text: string) => void
  /** Save the draft; `fill` fills the selection; `move` = [dRow, dCol] afterwards. */
  onCommit: (fill: boolean, move?: [number, number]) => void
  onCancel: () => void
}) {
  return (
    <td
      role="gridcell"
      aria-selected={selected}
      data-row={row}
      data-col={col}
      style={{ boxShadow: edgeShadow(edges) }}
      className={cn(
        "relative h-11 min-w-11 cursor-cell border-b px-1 text-center tabular-nums",
        HEAT[heat],
        current && heat === 0 && "bg-accent/60",
        implied && "text-muted-foreground italic",
        selected &&
          !active &&
          "after:pointer-events-none after:absolute after:inset-0 after:bg-primary/12",
        fillPreview &&
          "outline-1 -outline-offset-2 outline-primary/60 outline-dashed after:pointer-events-none after:absolute after:inset-0 after:bg-primary/6",
        active && "outline-2 -outline-offset-2 outline-primary"
      )}
      onMouseDown={(e) => onMouseDown(e, { row, col })}
      onMouseEnter={() => onMouseEnter({ row, col })}
      onDoubleClick={() => onDoubleClick({ row, col })}
    >
      {editing ? (
        <input
          autoFocus
          aria-label="Hours"
          inputMode="decimal"
          value={editing.text}
          onChange={(e) => onDraftChange(e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
          onBlur={() => onCommit(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              const fill = e.metaKey || e.ctrlKey
              // Filling keeps the selection; a plain Enter moves on.
              onCommit(fill, fill ? undefined : [e.shiftKey ? -1 : 1, 0])
            } else if (e.key === "Tab") {
              e.preventDefault()
              onCommit(false, [0, e.shiftKey ? -1 : 1])
            } else if (e.key === "Escape") {
              e.preventDefault()
              onCancel()
            }
          }}
          className="absolute inset-0 z-10 w-full bg-background px-1 text-center tabular-nums outline-2 -outline-offset-2 outline-primary"
        />
      ) : (
        formatAmount(value)
      )}
      {showHandle && (
        <span
          aria-hidden
          data-fill-handle
          onMouseDown={onFillHandleDown}
          className="absolute -right-[5px] -bottom-[5px] z-20 size-2.5 cursor-crosshair rounded-[2px] border-2 border-background bg-primary"
        />
      )}
    </td>
  )
})
