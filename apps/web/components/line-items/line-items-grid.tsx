"use client"

import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import type {
  CollisionDetection,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/core"
import {
  createColumnHelper,
  rowSelectionFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table"
import type { CellContext, RowSelectionState } from "@tanstack/react-table"
import {
  CalendarClockIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  CopyPlusIcon,
  FolderInputIcon,
  FolderPlusIcon,
  GripVerticalIcon,
  ListPlusIcon,
  MoreHorizontalIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react"
import { createContext, useContext, useId, useState } from "react"
import { toast } from "sonner"

import { canPlacePhase, MAX_PHASE_DEPTH } from "@workspace/domain/phases"
import type { PhaseRollup } from "@workspace/domain/phases"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

import type { EditorLine, EditorPhase } from "@/components/quotes/autosave"
import { InlineDate } from "@/components/quotes/inline-date"
import { InlineText } from "@/components/quotes/inline-text"
import { useLabels } from "@/components/shell/labels"
import { formatDate } from "@/lib/format"
import { formatMoney, isMoneyInput, trimMoney } from "@/lib/money"
import { phaseOptions, resolveDrop } from "@/lib/phase-tree"
import type {
  DragSource,
  DropCommand,
  DropTarget,
  PhaseOption,
} from "@/lib/phase-tree"

/** Quantity as typed: digits with up to 3 decimals. */
const QUANTITY_INPUT = /^\d{1,15}(\.\d{1,3})?$/

/** One row of the grid: a Phase (with its derived figures) or a Line Item. */
export type GridRow =
  | {
      kind: "phase"
      /** `phase:<id>`, so Phase and line ids never clash. */
      id: string
      phase: EditorPhase
      depth: number
      rollup: PhaseRollup
    }
  | { kind: "line"; id: string; line: EditorLine; depth: number }

const PHASE_ROW_PREFIX = "phase:"
const END_ZONE_ID = "grid:end"

/** The drag/drop identity of a grid row id. */
function sourceOf(rowId: string): DragSource {
  return rowId.startsWith(PHASE_ROW_PREFIX)
    ? { kind: "phase", id: rowId.slice(PHASE_ROW_PREFIX.length) }
    : { kind: "line", id: rowId }
}

function targetOf(rowId: string): DropTarget {
  return rowId === END_ZONE_ID ? { kind: "end" } : sourceOf(rowId)
}

/**
 * The Line Items grid's features: row selection (Line Items only) for bulk
 * move, clone and delete. Rows come in grid order, Phases interleaved.
 */
const lineItemFeatures = tableFeatures({ rowSelectionFeature })
const helper = createColumnHelper<typeof lineItemFeatures, GridRow>()

/** What an edit cell sends: one field of one line. */
export type LineItemPatch = {
  id: string
  name?: string
  notes?: string | null
  startDate?: string
  endDate?: string
  quantity?: string
  /** `null` resets to the Base Rate price. */
  unitPrice?: string | null
}

/** The grid's gestures; each becomes one command. */
export interface GridActions {
  onUpdate: (patch: LineItemPatch) => void
  onDelete: (ids: string[]) => void
  onMoveLines: (move: {
    ids: string[]
    phaseId: string | null
    beforeId?: string | null
  }) => void
  onCloneLines: (clone: { ids: string[]; phaseId?: string | null }) => void
  onRenamePhase: (id: string, name: string) => void
  onMovePhase: (move: {
    id: string
    parentId: string | null
    beforeId?: string | null
  }) => void
  onDeletePhase: (id: string) => void
  onClonePhase: (id: string) => void
  onAddSubPhase: (parentId: string) => void
  onAddItemsTo: (phaseId: string) => void
  onToggleCollapsed: (phaseId: string) => void
}

const UNIT_LABELS = { each: "Each", hour: "Hour" } as const

/** What the cells need besides their row; provided by `LineItemsGrid`. */
interface GridContextValue extends GridActions {
  currency: string
  quoteStartDate: string
  quoteEndDate: string
  readOnly: boolean
  phases: readonly EditorPhase[]
  options: PhaseOption[]
  collapsed: ReadonlySet<string>
}

const GridContext = createContext<GridContextValue | null>(null)
const useGrid = () => useContext(GridContext)!

type Cell = CellContext<typeof lineItemFeatures, GridRow, unknown>

/** The line of a line row (cells only render for line rows). */
function lineOf(row: Cell["row"]): { line: EditorLine; depth: number } {
  const value = row.original
  if (value.kind !== "line") throw new Error("Not a line row")
  return value
}

/** Left padding for a row at `depth` (lines outside Phases are depth 0). */
const indent = (depth: number) => ({ paddingLeft: `${depth * 1.25}rem` })

// Cells are module-level components reading `GridContext`, so the column
// definitions never change identity and an edit cell keeps its focus and
// draft across re-renders (polling, other commands settling).

/** The drag handle of a row (registered with dnd-kit as the row's draggable). */
function DragHandle({ rowId, label }: { rowId: string; label: string }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: rowId })
  return (
    <button
      ref={setNodeRef}
      type="button"
      aria-label={`Drag ${label}`}
      className="flex size-6 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <GripVerticalIcon className="size-4" />
    </button>
  )
}

function SelectCell({ row }: Cell) {
  const { line } = lineOf(row)
  return (
    <div className="flex items-center gap-1">
      <DragHandle rowId={row.id} label={line.name} />
      <Checkbox
        aria-label={`Select ${line.name}`}
        checked={row.getIsSelected()}
        onCheckedChange={(checked) => row.toggleSelected(checked === true)}
      />
    </div>
  )
}

function NameCell({ row }: Cell) {
  const { readOnly, onUpdate } = useGrid()
  const labels = useLabels()
  const { line, depth } = lineOf(row)
  return (
    <div className="flex min-w-48 flex-col" style={indent(depth)}>
      <InlineText
        label="Name"
        value={line.name}
        required
        maxLength={200}
        disabled={readOnly}
        className="font-medium"
        onSave={(name) => name && onUpdate({ id: line.id, name })}
      />
      <span className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
        {labels[line.sourceKind].singular}
        {line.plannerManaged && (
          <Badge variant="secondary" className="h-4 px-1 text-[10px]">
            <CalendarClockIcon />
            Planned
          </Badge>
        )}
      </span>
    </div>
  )
}

function NotesCell({ row }: Cell) {
  const { readOnly, onUpdate } = useGrid()
  const { line } = lineOf(row)
  return (
    <InlineText
      label="Notes"
      value={line.notes}
      maxLength={2000}
      disabled={readOnly}
      placeholder={readOnly ? "" : "Add notes"}
      className="min-w-40 text-sm"
      onSave={(notes) => onUpdate({ id: line.id, notes })}
    />
  )
}

function StartCell({ row }: Cell) {
  const { readOnly, onUpdate, quoteStartDate, quoteEndDate } = useGrid()
  const { line } = lineOf(row)
  // A planner-managed line's start lifts and shifts its Allocations (the
  // end moves with it), so it may go anywhere within the Quote.
  return (
    <InlineDate
      label="Start date"
      value={line.startDate}
      min={quoteStartDate}
      max={line.plannerManaged ? quoteEndDate : line.endDate}
      disabled={readOnly}
      onSave={(startDate) => onUpdate({ id: line.id, startDate })}
    />
  )
}

function EndCell({ row }: Cell) {
  const { readOnly, onUpdate, quoteEndDate } = useGrid()
  const { line } = lineOf(row)
  return (
    <InlineDate
      label="End date"
      value={line.endDate}
      min={line.startDate}
      max={quoteEndDate}
      disabled={readOnly || line.plannerManaged}
      onSave={(endDate) => onUpdate({ id: line.id, endDate })}
    />
  )
}

function QuantityCell({ row }: Cell) {
  const { readOnly, onUpdate } = useGrid()
  const { line } = lineOf(row)
  return (
    <InlineText
      label="Quantity"
      value={trimMoney(line.quantity)}
      required
      inputMode="decimal"
      disabled={readOnly}
      validate={(v) =>
        QUANTITY_INPUT.test(v)
          ? null
          : "Enter a quantity of 0 or more with up to 3 decimals."
      }
      className="w-24 text-right tabular-nums"
      onSave={(quantity) => quantity && onUpdate({ id: line.id, quantity })}
    />
  )
}

function UnitCell({ row }: Cell) {
  return (
    <span className="text-muted-foreground">
      {UNIT_LABELS[lineOf(row).line.billingUnit]}
    </span>
  )
}

function UnitPriceCell({ row }: Cell) {
  const { readOnly, onUpdate, currency } = useGrid()
  const { line } = lineOf(row)
  const overridden = trimMoney(line.unitPrice) !== trimMoney(line.basePrice)
  const base = formatMoney(line.basePrice, currency)
  return (
    <div className="flex items-center justify-end gap-1">
      {overridden && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={readOnly}
                aria-label={`Reset to the Base Rate, ${base}`}
                onClick={() => onUpdate({ id: line.id, unitPrice: null })}
              />
            }
          >
            <RotateCcwIcon />
          </TooltipTrigger>
          <TooltipContent>
            Overrides the Base Rate of {base}
            {readOnly ? "" : ". Click to reset."}
          </TooltipContent>
        </Tooltip>
      )}
      <InlineText
        label="Unit price"
        value={trimMoney(line.unitPrice)}
        required
        inputMode="decimal"
        disabled={readOnly}
        validate={(v) =>
          isMoneyInput(v)
            ? null
            : "Enter a price of 0 or more with up to 4 decimals."
        }
        className={cn(
          "w-28 text-right tabular-nums",
          overridden && "font-medium text-amber-700 dark:text-amber-400"
        )}
        onSave={(unitPrice) =>
          unitPrice && onUpdate({ id: line.id, unitPrice })
        }
      />
    </div>
  )
}

function LineTotalCell({ row }: Cell) {
  const { currency } = useGrid()
  return (
    <div className="px-2 text-right font-medium tabular-nums">
      {formatMoney(lineOf(row).line.lineTotal, currency)}
    </div>
  )
}

function MarginCell({ row }: Cell) {
  const pct = lineOf(row).line.lineMarginPct
  return (
    <div
      className={cn(
        "px-2 text-right tabular-nums",
        pct.startsWith("-") && "text-destructive"
      )}
    >
      {trimMoney(pct)}%
    </div>
  )
}

/** The Phase submenu items for "Move to" / "Duplicate into". */
function PhaseMenuItems({
  current,
  onPick,
}: {
  current?: string | null
  onPick: (phaseId: string | null) => void
}) {
  const { options } = useGrid()
  const labels = useLabels()
  return (
    <>
      <DropdownMenuItem
        disabled={current === null}
        onClick={() => onPick(null)}
      >
        No {labels.phase.singular}
      </DropdownMenuItem>
      {options.length > 0 && <DropdownMenuSeparator />}
      {options.map((option) => (
        <DropdownMenuItem
          key={option.value}
          disabled={current === option.value}
          onClick={() => onPick(option.value)}
        >
          <span style={indent(option.depth - 1)}>{option.label.trim()}</span>
        </DropdownMenuItem>
      ))}
    </>
  )
}

function LineActionsCell({ row }: Cell) {
  const { onDelete, onCloneLines, onMoveLines } = useGrid()
  const { line } = lineOf(row)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${line.name}`}
          />
        }
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => onCloneLines({ ids: [line.id] })}>
          <CopyIcon />
          Clone
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <CopyPlusIcon />
            Duplicate into
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
            <PhaseMenuItems
              onPick={(phaseId) => onCloneLines({ ids: [line.id], phaseId })}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <FolderInputIcon />
            Move to
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
            <PhaseMenuItems
              current={line.phaseId}
              onPick={(phaseId) => onMoveLines({ ids: [line.id], phaseId })}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => onDelete([line.id])}
        >
          <Trash2Icon />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const right = (label: string) => {
  function RightHeader() {
    return <div className="text-right">{label}</div>
  }
  return RightHeader
}

const dataColumns = [
  helper.display({ id: "name", header: "Name", cell: NameCell }),
  helper.display({ id: "notes", header: "Notes", cell: NotesCell }),
  helper.display({ id: "startDate", header: "Start", cell: StartCell }),
  helper.display({ id: "endDate", header: "End", cell: EndCell }),
  helper.display({
    id: "quantity",
    header: right("Quantity"),
    cell: QuantityCell,
  }),
  helper.display({ id: "unit", header: "Unit", cell: UnitCell }),
  helper.display({
    id: "unitPrice",
    header: right("Unit price"),
    cell: UnitPriceCell,
  }),
  helper.display({
    id: "lineTotal",
    header: right("Line total"),
    cell: LineTotalCell,
  }),
  helper.display({
    id: "lineMarginPct",
    header: right("Margin"),
    cell: MarginCell,
  }),
]

/** Read-only grid: just the data columns. */
const readOnlyColumns = helper.columns(dataColumns)

/** Editable grid: a drag-and-select column first and an actions column last. */
const editableColumns = helper.columns([
  helper.display({
    id: "select",
    header: ({ table }) => (
      <Checkbox
        aria-label="Select all Line Items"
        className="ml-7"
        checked={table.getIsAllRowsSelected()}
        indeterminate={
          table.getIsSomeRowsSelected() && !table.getIsAllRowsSelected()
        }
        onCheckedChange={(checked) =>
          table.toggleAllRowsSelected(checked === true)
        }
      />
    ),
    cell: SelectCell,
  }),
  ...dataColumns,
  helper.display({
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: LineActionsCell,
  }),
])

/** A `<tr>` that is a drop target for drag-and-drop. */
function DroppableRow({
  id,
  hint,
  className,
  children,
  ...props
}: React.ComponentProps<typeof TableRow> & {
  id: string
  hint: "before" | "into" | null
}) {
  const { setNodeRef } = useDroppable({ id })
  return (
    <TableRow
      ref={setNodeRef}
      className={cn(
        hint === "before" && "shadow-[inset_0_2px_0_0_var(--color-primary)]",
        hint === "into" && "bg-primary/10 ring-2 ring-primary ring-inset",
        className
      )}
      {...props}
    >
      {children}
    </TableRow>
  )
}

/** The actions menu of a Phase row. */
function PhaseActions({ phase, depth }: { phase: EditorPhase; depth: number }) {
  const {
    phases,
    onAddSubPhase,
    onAddItemsTo,
    onClonePhase,
    onMovePhase,
    onDeletePhase,
    options,
  } = useGrid()
  const labels = useLabels()
  const { singular } = labels.phase
  // Valid new parents: top level, or any Phase canPlacePhase allows.
  const targets = options.filter(
    (o) =>
      o.value !== phase.parentId &&
      canPlacePhase(phases, { phaseId: phase.id, parentId: o.value }).ok
  )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${phase.name}`}
          />
        }
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={() => onAddItemsTo(phase.id)}>
          <ListPlusIcon />
          Add items here
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={depth >= MAX_PHASE_DEPTH}
          onClick={() => onAddSubPhase(phase.id)}
        >
          <FolderPlusIcon />
          Add sub-{singular.toLowerCase()}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onClonePhase(phase.id)}>
          <CopyIcon />
          Clone {singular.toLowerCase()}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <FolderInputIcon />
            Move to
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
            <DropdownMenuItem
              disabled={phase.parentId === null}
              onClick={() => onMovePhase({ id: phase.id, parentId: null })}
            >
              Top level
            </DropdownMenuItem>
            {targets.length > 0 && <DropdownMenuSeparator />}
            {targets.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onClick={() =>
                  onMovePhase({ id: phase.id, parentId: option.value })
                }
              >
                <span style={indent(option.depth - 1)}>
                  {option.label.trim()}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => onDeletePhase(phase.id)}
        >
          <Trash2Icon />
          Delete {singular.toLowerCase()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * A Phase row: its cells line up with the columns (`columnIds`). It shows
 * the name (renamed inline), expand/collapse, what it holds, and the
 * totals and date span derived from its contents.
 */
function PhaseRowCells({
  row,
  columnIds,
}: {
  row: Extract<GridRow, { kind: "phase" }>
  columnIds: string[]
}) {
  const { currency, readOnly, collapsed, onToggleCollapsed, onRenamePhase } =
    useGrid()
  const labels = useLabels()
  const { phase, rollup, depth } = row
  const open = !collapsed.has(phase.id)
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon
  const contents = [
    rollup.phaseCount > 0 &&
      `${rollup.phaseCount} ${
        rollup.phaseCount === 1
          ? `sub-${labels.phase.singular.toLowerCase()}`
          : `sub-${labels.phase.plural.toLowerCase()}`
      }`,
    `${rollup.lineCount} ${rollup.lineCount === 1 ? "Line Item" : "Line Items"}`,
  ]
    .filter(Boolean)
    .join(" · ")

  const cells: React.ReactNode[] = []
  for (const columnId of columnIds) {
    switch (columnId) {
      case "select":
        cells.push(
          <TableCell key={columnId} className="py-1">
            <DragHandle rowId={row.id} label={phase.name} />
          </TableCell>
        )
        break
      case "name":
        cells.push(
          <TableCell key={columnId} colSpan={2} className="py-1">
            <div className="flex items-center gap-1" style={indent(depth - 1)}>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`${open ? "Collapse" : "Expand"} ${phase.name}`}
                aria-expanded={open}
                onClick={() => onToggleCollapsed(phase.id)}
              >
                <Chevron />
              </Button>
              <div className="flex min-w-48 flex-col">
                <InlineText
                  label={`${labels.phase.singular} name`}
                  value={phase.name}
                  required
                  maxLength={200}
                  disabled={readOnly}
                  className="font-semibold"
                  onSave={(name) => name && onRenamePhase(phase.id, name)}
                />
                <span className="px-2 text-xs text-muted-foreground">
                  {labels.phase.singular} · {contents}
                </span>
              </div>
            </div>
          </TableCell>
        )
        break
      case "notes":
        break
      case "startDate":
      case "endDate": {
        const date =
          columnId === "startDate" ? rollup.startDate : rollup.endDate
        cells.push(
          <TableCell
            key={columnId}
            className="px-4 py-1 text-sm text-muted-foreground tabular-nums"
          >
            {date ? formatDate(date) : "—"}
          </TableCell>
        )
        break
      }
      case "quantity":
        cells.push(<TableCell key={columnId} colSpan={3} />)
        break
      case "unit":
      case "unitPrice":
        break
      case "lineTotal":
        cells.push(
          <TableCell
            key={columnId}
            className="px-4 py-1 text-right font-semibold tabular-nums"
          >
            {formatMoney(rollup.total, currency)}
          </TableCell>
        )
        break
      case "lineMarginPct":
        cells.push(
          <TableCell
            key={columnId}
            className={cn(
              "px-4 py-1 text-right text-muted-foreground tabular-nums",
              rollup.marginPct.startsWith("-") && "text-destructive"
            )}
          >
            {trimMoney(rollup.marginPct)}%
          </TableCell>
        )
        break
      case "actions":
        cells.push(
          <TableCell key={columnId} className="py-1">
            <PhaseActions phase={phase} depth={depth} />
          </TableCell>
        )
        break
    }
  }
  return <>{cells}</>
}

// Pointer-driven drags use the row under the pointer; keyboard drags the
// closest row.
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  return hits.length > 0 ? hits : closestCenter(args)
}

/**
 * The Line Items grid (TanStack Table): Phase rows (expand/collapse,
 * inline rename, derived total, margin and date span, actions) with their
 * Line Items indented under them, and per line: name, notes, start and
 * end dates, quantity, unit, unit price (marked when it overrides the
 * Base Rate, with a reset), line total and line margin. Every editable
 * cell autosaves through `onUpdate`. Rows drag by their handle (dnd-kit):
 * each drop is one command (see `resolveDrop` for what a drop means), and
 * dragging a selected line moves the whole selection. `readOnly` (locked
 * Quote or no edit permission) disables every cell and drops the select,
 * drag and actions.
 */
export function LineItemsGrid({
  rows,
  phases,
  lines,
  currency,
  quoteStartDate,
  quoteEndDate,
  readOnly,
  selection,
  onSelectionChange,
  collapsed,
  actions,
}: {
  rows: GridRow[]
  phases: readonly EditorPhase[]
  lines: readonly EditorLine[]
  currency: string
  quoteStartDate: string
  quoteEndDate: string
  readOnly: boolean
  selection: RowSelectionState
  onSelectionChange: (selection: RowSelectionState) => void
  collapsed: ReadonlySet<string>
  actions: GridActions
}) {
  const labels = useLabels()
  const table = useTable({
    features: lineItemFeatures,
    columns: readOnly ? readOnlyColumns : editableColumns,
    data: rows,
    getRowId: (row) => row.id,
    enableRowSelection: (row) => !readOnly && row.original.kind === "line",
    state: { rowSelection: selection },
    onRowSelectionChange: (updater) =>
      onSelectionChange(
        typeof updater === "function" ? updater(selection) : updater
      ),
  })
  const columnIds = table.getAllLeafColumns().map((c) => c.id)

  // A stable id keeps dnd-kit's aria ids equal on the server and client.
  const dndId = useId()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor)
  )
  const [drag, setDrag] = useState<{
    activeId: string
    overId: string | null
  } | null>(null)
  const selectedIds = Object.keys(selection).filter((id) => selection[id])

  const commandFor = (activeId: string, overId: string | null) =>
    overId
      ? resolveDrop(
          phases,
          lines,
          sourceOf(activeId),
          targetOf(overId),
          selectedIds
        )
      : null
  const pending: DropCommand | null = drag
    ? commandFor(drag.activeId, drag.overId)
    : null
  const hintFor = (rowId: string): "before" | "into" | null => {
    if (!pending || drag?.overId !== rowId) return null
    return pending.kind === "lines" && pending.into ? "into" : "before"
  }

  const onDragStart = ({ active }: DragStartEvent) =>
    setDrag({ activeId: String(active.id), overId: null })
  const onDragOver = ({ active, over }: DragOverEvent) =>
    setDrag({
      activeId: String(active.id),
      overId: over ? String(over.id) : null,
    })
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDrag(null)
    const command = commandFor(String(active.id), over ? String(over.id) : null)
    if (!command) return
    if (command.kind === "lines") {
      actions.onMoveLines({
        ids: command.ids,
        phaseId: command.phaseId,
        beforeId: command.beforeId,
      })
      return
    }
    const check = canPlacePhase(phases, {
      phaseId: command.id,
      parentId: command.parentId,
    })
    if (!check.ok) {
      toast.error(
        check.reason === "too_deep"
          ? `${labels.phase.plural} can nest at most ${MAX_PHASE_DEPTH} levels deep.`
          : `A ${labels.phase.singular.toLowerCase()} can't be moved inside itself.`
      )
      return
    }
    actions.onMovePhase({
      id: command.id,
      parentId: command.parentId,
      beforeId: command.beforeId,
    })
  }

  const active = drag ? sourceOf(drag.activeId) : null
  const overlayLabel = (() => {
    if (!active) return null
    if (active.kind === "phase") {
      return phases.find((p) => p.id === active.id)?.name ?? ""
    }
    const n = selectedIds.includes(active.id) ? selectedIds.length : 1
    return n === 1
      ? (lines.find((l) => l.id === active.id)?.name ?? "")
      : `${n} Line Items`
  })()

  return (
    <GridContext
      value={{
        ...actions,
        currency,
        quoteStartDate,
        quoteEndDate,
        readOnly,
        phases,
        options: phaseOptions(phases),
        collapsed,
      }}
    >
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDrag(null)}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              "To move this row, press Space or Enter, use the arrow keys to choose where, then press Space or Enter again to drop it, or Escape to cancel.",
          },
        }}
      >
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id}>
                  {group.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder ? null : (
                        <table.FlexRender header={header} />
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) =>
                row.original.kind === "phase" ? (
                  <DroppableRow
                    key={row.id}
                    id={row.id}
                    hint={hintFor(row.id)}
                    className="bg-muted/40 hover:bg-muted/60"
                  >
                    <PhaseRowCells row={row.original} columnIds={columnIds} />
                  </DroppableRow>
                ) : (
                  <DroppableRow
                    key={row.id}
                    id={row.id}
                    hint={hintFor(row.id)}
                    data-state={row.getIsSelected() ? "selected" : undefined}
                  >
                    {row.getAllCells().map((cell) => (
                      <TableCell key={cell.id} className="py-1">
                        <table.FlexRender cell={cell} />
                      </TableCell>
                    ))}
                  </DroppableRow>
                )
              )}
              {!readOnly && drag && (
                <DroppableRow
                  id={END_ZONE_ID}
                  hint={hintFor(END_ZONE_ID)}
                  className="hover:bg-transparent"
                >
                  <TableCell
                    colSpan={columnIds.length}
                    className="py-3 text-center text-sm text-muted-foreground"
                  >
                    Drop here to move to the end, outside every{" "}
                    {labels.phase.singular.toLowerCase()}
                  </TableCell>
                </DroppableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <DragOverlay dropAnimation={null}>
          {overlayLabel !== null && (
            <div className="flex w-fit items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm font-medium shadow-lg">
              <GripVerticalIcon className="size-4 text-muted-foreground" />
              {overlayLabel}
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </GridContext>
  )
}
