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
import { flexRender } from "@tanstack/react-table"
import type { ExpandedState, RowSelectionState } from "@tanstack/react-table"
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
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react"
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useId,
  useState,
} from "react"
import { toast } from "sonner"

import { Decimal } from "@workspace/domain/money"
import { canPlacePhase, MAX_PHASE_DEPTH } from "@workspace/domain/phases"
import type { PhaseRollup } from "@workspace/domain/phases"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  RowMenuItem,
  RowMenuSeparator,
  RowMenuSub,
  RowMenuSubContent,
  RowMenuSubTrigger,
  useDataTableRow,
} from "@workspace/ui/components/niko-table/components/data-table-row-menu"
import { DataTable } from "@workspace/ui/components/niko-table/core/data-table"
import { useDataTable } from "@workspace/ui/components/niko-table/core/data-table-context"
import { DataTableRoot } from "@workspace/ui/components/niko-table/core/data-table-root"
import { DataTableHeader } from "@workspace/ui/components/niko-table/core/data-table-structure"
import type {
  DataTableColumns,
  DataTableRow,
} from "@workspace/ui/components/niko-table/types"
import { TableBody, TableCell, TableRow } from "@workspace/ui/components/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

import type { EditorLine, EditorPhase } from "@/components/quotes/autosave"
import { InlineDate } from "@/components/quotes/inline-date"
import { InlineText } from "@/components/quotes/inline-text"
import {
  ColumnTitle,
  LIST_TABLE_CLASS,
  resolveUpdater,
  RowActionsMenu,
  RowContextMenuArea,
  selectableRows,
} from "@/components/shell/data-table"
import { useLabels } from "@/components/shell/labels"
import { ItemTypeTag, PHASE_TINT_CLASSES } from "@/components/shell/tints"
import { formatDate } from "@/lib/format"
import { formatMoney, isMoneyInput, trimMoney } from "@/lib/money"
import { phaseTints } from "@/lib/phase-tints"
import { phaseOptions, resolveDrop } from "@/lib/phase-tree"
import type {
  DragSource,
  DropCommand,
  DropTarget,
  PhaseOption,
} from "@/lib/phase-tree"

/** Quantity as typed: digits with up to 3 decimals. */
const QUANTITY_INPUT = /^\d{1,15}(\.\d{1,3})?$/

/**
 * One row of the grid: a Phase (with its derived figures) or a Line Item.
 * Phase rows carry their contents as `subRows` (niko-table's tree: the
 * table's expanded row model shows them unless the Phase is collapsed).
 */
export type GridRow =
  | {
      kind: "phase"
      /** `phase:<id>`, so Phase and line ids never clash. */
      id: string
      phase: EditorPhase
      depth: number
      rollup: PhaseRollup
      subRows: GridRow[]
    }
  | {
      kind: "line"
      id: string
      line: EditorLine
      depth: number
      subRows?: undefined
    }

/** The grid row id of a Phase. */
export const phaseRowId = (phaseId: string) => `${PHASE_ROW_PREFIX}${phaseId}`

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

// Module-level so the table options stay stable.
const rowIdOf = (row: GridRow) => row.id
const subRowsOf = (row: GridRow) => row.subRows
/** Only Line Items are selectable (bulk move, clone and delete). */
const canSelect = (row: { original: GridRow }) => row.original.kind === "line"

/** The right-click menu of a grid row: a Phase's or a Line Item's. */
const rowMenuOf = (row: GridRow) =>
  row.kind === "phase" ? <PhaseRowMenu /> : <LineRowMenu />
const noRowMenu = () => null

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
  /** Each Phase's tint (`phaseTints`), for its rows and its children's. */
  tints: ReadonlyMap<string, number>
}

const GridContext = createContext<GridContextValue | null>(null)
const useGrid = () => useContext(GridContext)!

type Cell = { row: DataTableRow<GridRow> }

/** The line of a line row (cells only render for line rows). */
function lineOf(row: Cell["row"]): { line: EditorLine; depth: number } {
  const value = row.original
  if (value.kind !== "line") throw new Error("Not a line row")
  return value
}

/** Left padding for a row at `depth` (lines outside Phases are depth 0). */
const indent = (depth: number) => ({ paddingLeft: `${depth * 1.25}rem` })

/**
 * Tree layout of the Name column, in rem: each level steps in by `STEP`; a
 * Phase's chevron sits at its level, and its Line Items start past the
 * Phase's own name (`LINE_INSET`), so they read as its children.
 */
const STEP = 1.5
const LINE_INSET = 2.5
/** The x of the guide line under the chevron at `level` (1 = top). */
const guideX = (level: number) => (level - 1) * STEP + 0.75

/**
 * The tree guides of a row: one thin line per ancestor level, down the
 * cell, in the Phase's tint, so a Phase's children hang off its chevron.
 */
function TreeGuides({ levels, tint }: { levels: number; tint?: number }) {
  if (levels <= 0) return null
  const colour = tint ? PHASE_TINT_CLASSES[tint]!.guide : "bg-border"
  return (
    <>
      {Array.from({ length: levels }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className={cn("pointer-events-none absolute -inset-y-1 w-px", colour)}
          style={{ left: `${guideX(i + 1)}rem` }}
        />
      ))}
    </>
  )
}

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
  const { readOnly, onUpdate, tints } = useGrid()
  const { line, depth } = lineOf(row)
  const tint = line.phaseId ? tints.get(line.phaseId) : undefined
  return (
    <div
      className="relative flex min-w-40 flex-col"
      style={{
        paddingLeft: depth > 0 ? `${(depth - 1) * STEP + LINE_INSET}rem` : 0,
      }}
    >
      <TreeGuides levels={depth} tint={tint} />
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
        <ItemTypeTag line={line} />
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
      className="w-20 text-right tabular-nums"
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
          "w-20 text-right tabular-nums",
          overridden && "font-medium text-warning-ink"
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
      {new Decimal(pct).toFixed(1)}%
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
      <RowMenuItem disabled={current === null} onClick={() => onPick(null)}>
        No {labels.phase.singular}
      </RowMenuItem>
      {options.length > 0 && <RowMenuSeparator />}
      {options.map((option) => (
        <RowMenuItem
          key={option.value}
          disabled={current === option.value}
          onClick={() => onPick(option.value)}
        >
          <span style={indent(option.depth - 1)}>{option.label.trim()}</span>
        </RowMenuItem>
      ))}
    </>
  )
}

/**
 * A Line Item's actions: its "…" menu and its right-click menu (niko's
 * row menu pieces render as either).
 */
function LineRowMenu() {
  const { onDelete, onCloneLines, onMoveLines } = useGrid()
  const row = useDataTableRow<GridRow>()
  if (row.kind !== "line") return null
  const { line } = row
  return (
    <>
      <RowMenuItem onClick={() => onCloneLines({ ids: [line.id] })}>
        <CopyIcon />
        Clone
      </RowMenuItem>
      <RowMenuSub>
        <RowMenuSubTrigger>
          <CopyPlusIcon />
          Duplicate into
        </RowMenuSubTrigger>
        <RowMenuSubContent className="max-h-80 overflow-y-auto">
          <PhaseMenuItems
            onPick={(phaseId) => onCloneLines({ ids: [line.id], phaseId })}
          />
        </RowMenuSubContent>
      </RowMenuSub>
      <RowMenuSub>
        <RowMenuSubTrigger>
          <FolderInputIcon />
          Move to
        </RowMenuSubTrigger>
        <RowMenuSubContent className="max-h-80 overflow-y-auto">
          <PhaseMenuItems
            current={line.phaseId}
            onPick={(phaseId) => onMoveLines({ ids: [line.id], phaseId })}
          />
        </RowMenuSubContent>
      </RowMenuSub>
      <RowMenuSeparator />
      <RowMenuItem variant="destructive" onClick={() => onDelete([line.id])}>
        <Trash2Icon />
        Delete
      </RowMenuItem>
    </>
  )
}

function LineActionsCell({ row }: Cell) {
  const { line } = lineOf(row)
  return (
    <RowActionsMenu
      row={row.original}
      label={`Actions for ${line.name}`}
      className="w-52"
    >
      <LineRowMenu />
    </RowActionsMenu>
  )
}

const dataColumns: DataTableColumns<GridRow> = [
  { id: "name", header: ColumnTitle, meta: { label: "Name" }, cell: NameCell },
  {
    id: "startDate",
    header: ColumnTitle,
    meta: { label: "Start" },
    cell: StartCell,
  },
  { id: "endDate", header: ColumnTitle, meta: { label: "End" }, cell: EndCell },
  {
    id: "quantity",
    header: ColumnTitle,
    meta: { label: "Quantity", align: "end" },
    cell: QuantityCell,
  },
  { id: "unit", header: ColumnTitle, meta: { label: "Unit" }, cell: UnitCell },
  {
    id: "unitPrice",
    header: ColumnTitle,
    meta: { label: "Unit price", align: "end" },
    cell: UnitPriceCell,
  },
  {
    id: "lineTotal",
    header: ColumnTitle,
    meta: { label: "Line total", align: "end" },
    cell: LineTotalCell,
  },
  {
    id: "lineMarginPct",
    header: ColumnTitle,
    meta: { label: "Margin", align: "end" },
    cell: MarginCell,
  },
]

/** Read-only grid: just the data columns. */
const readOnlyColumns = dataColumns

/** Editable grid: a drag-and-select column first and an actions column last. */
const editableColumns: DataTableColumns<GridRow> = [
  {
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
  },
  ...dataColumns,
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: LineActionsCell,
  },
]

/** A `<tr>` that is a drop target for drag-and-drop. */
function DroppableRow({
  id,
  hint,
  className,
  children,
  ref,
  ...props
}: React.ComponentProps<typeof TableRow> & {
  id: string
  hint: "before" | "into" | null
}) {
  const { setNodeRef } = useDroppable({ id })
  // The row is also the context menu's trigger, which passes its own ref.
  const setRef = useCallback(
    (node: HTMLTableRowElement | null) => {
      setNodeRef(node)
      if (typeof ref === "function") ref(node)
      else if (ref) ref.current = node
    },
    [setNodeRef, ref]
  )
  return (
    <TableRow
      ref={setRef}
      className={cn(
        className,
        // the drop hint wins over the row's own tint edge while dragging
        hint === "before" && "shadow-[inset_0_2px_0_0_var(--color-primary)]",
        hint === "into" && "bg-primary/10 ring-2 ring-primary ring-inset"
      )}
      {...props}
    >
      {children}
    </TableRow>
  )
}

/** A Phase row's actions: its "…" menu and its right-click menu. */
function PhaseRowMenu() {
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
  const row = useDataTableRow<GridRow>()
  if (row.kind !== "phase") return null
  const { phase, depth } = row
  const { singular } = labels.phase
  // Valid new parents: top level, or any Phase canPlacePhase allows.
  const targets = options.filter(
    (o) =>
      o.value !== phase.parentId &&
      canPlacePhase(phases, { phaseId: phase.id, parentId: o.value }).ok
  )
  return (
    <>
      <RowMenuItem onClick={() => onAddItemsTo(phase.id)}>
        <ListPlusIcon />
        Add items here
      </RowMenuItem>
      <RowMenuItem
        disabled={depth >= MAX_PHASE_DEPTH}
        onClick={() => onAddSubPhase(phase.id)}
      >
        <FolderPlusIcon />
        Add sub-{singular.toLowerCase()}
      </RowMenuItem>
      <RowMenuItem onClick={() => onClonePhase(phase.id)}>
        <CopyIcon />
        Clone {singular.toLowerCase()}
      </RowMenuItem>
      <RowMenuSub>
        <RowMenuSubTrigger>
          <FolderInputIcon />
          Move to
        </RowMenuSubTrigger>
        <RowMenuSubContent className="max-h-80 overflow-y-auto">
          <RowMenuItem
            disabled={phase.parentId === null}
            onClick={() => onMovePhase({ id: phase.id, parentId: null })}
          >
            Top level
          </RowMenuItem>
          {targets.length > 0 && <RowMenuSeparator />}
          {targets.map((option) => (
            <RowMenuItem
              key={option.value}
              onClick={() =>
                onMovePhase({ id: phase.id, parentId: option.value })
              }
            >
              <span style={indent(option.depth - 1)}>
                {option.label.trim()}
              </span>
            </RowMenuItem>
          ))}
        </RowMenuSubContent>
      </RowMenuSub>
      <RowMenuSeparator />
      <RowMenuItem
        variant="destructive"
        onClick={() => onDeletePhase(phase.id)}
      >
        <Trash2Icon />
        Delete {singular.toLowerCase()}
      </RowMenuItem>
    </>
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
  const {
    currency,
    readOnly,
    collapsed,
    tints,
    onToggleCollapsed,
    onRenamePhase,
  } = useGrid()
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
          <TableCell key={columnId} className="py-1">
            <div
              className="relative flex items-center gap-1"
              style={{ paddingLeft: `${(depth - 1) * STEP}rem` }}
            >
              <TreeGuides levels={depth - 1} tint={tints.get(phase.id)} />
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
                  className={cn(
                    "font-semibold",
                    depth === 1 && "text-[0.9375rem]"
                  )}
                  onSave={(name) => name && onRenamePhase(phase.id, name)}
                />
                <span className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      PHASE_TINT_CLASSES[tints.get(phase.id) ?? 1]!.dot
                    )}
                  />
                  {labels.phase.singular} · {contents}
                </span>
              </div>
            </div>
          </TableCell>
        )
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
            className="py-1 pr-4 text-right font-semibold tabular-nums"
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
              "py-1 pr-4 text-right text-muted-foreground tabular-nums",
              rollup.marginPct.startsWith("-") && "text-destructive"
            )}
          >
            {new Decimal(rollup.marginPct).toFixed(1)}%
          </TableCell>
        )
        break
      case "actions":
        cells.push(
          <TableCell key={columnId} className="py-1">
            <RowActionsMenu
              row={row}
              label={`Actions for ${phase.name}`}
              className="w-56"
            >
              <PhaseRowMenu />
            </RowActionsMenu>
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
 * The grid's rows, as niko-table's expanded row model yields them (the
 * contents of collapsed Phases left out): Phase rows span their columns,
 * line rows render their cells. Every row is a drop target and (when
 * editable) has the same right-click menu as its "…" menu.
 */
function LineItemsBody({
  columnIds,
  hintFor,
  dragging,
}: {
  columnIds: string[]
  hintFor: (rowId: string) => "before" | "into" | null
  dragging: boolean
}) {
  const { table } = useDataTable<GridRow>()
  const { readOnly, tints } = useGrid()
  // A Phase's rows share its tint: the Phase row washed, every row in it
  // with the tint's edge, so the block reads as one.
  const tintOf = (row: GridRow) => {
    const phaseId = row.kind === "phase" ? row.phase.id : row.line.phaseId
    const tint = phaseId ? tints.get(phaseId) : undefined
    return tint ? PHASE_TINT_CLASSES[tint] : undefined
  }
  const labels = useLabels()
  return (
    <TableBody>
      {table.getRowModel().rows.map((row) => {
        const element =
          row.original.kind === "phase" ? (
            <DroppableRow
              id={row.id}
              hint={hintFor(row.id)}
              data-row-id={row.id}
              className={cn(
                tintOf(row.original)?.row ?? "bg-muted/40 hover:bg-muted/60",
                tintOf(row.original)?.edge
              )}
            >
              <PhaseRowCells row={row.original} columnIds={columnIds} />
            </DroppableRow>
          ) : (
            <DroppableRow
              id={row.id}
              hint={hintFor(row.id)}
              data-row-id={row.id}
              data-state={row.getIsSelected() ? "selected" : undefined}
              className={tintOf(row.original)?.edge}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className="py-1">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </DroppableRow>
          )
        return <Fragment key={row.id}>{element}</Fragment>
      })}
      {!readOnly && dragging && (
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
  )
}

/**
 * The Line Items grid (niko-table): a tree table of Phase rows (expand /
 * collapse, inline rename, derived total, margin and date span, actions)
 * with their Line Items and sub-Phases nested under them (`subRows`), and
 * per line: name (with its item type), start and end dates, quantity, unit, unit price
 * (marked when it overrides the Base Rate, with a reset), line total and
 * line margin. Every editable cell autosaves through `onUpdate`. Rows drag
 * by their handle (dnd-kit, not niko's row DnD, which only reorders a flat
 * list): each drop is one command (see `resolveDrop` for what a drop means:
 * before a line, into a Phase, or the end zone), and dragging a selected
 * line moves the whole selection. Right-click a row for its menu.
 * `readOnly` (locked Quote or no edit permission) disables every cell and
 * drops the select, drag, menus and actions.
 */
export function LineItemsGrid({
  tree,
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
  /** The grid rows nested by Phase (`nestRows`), in grid order. */
  tree: GridRow[]
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
  const columns = readOnly ? readOnlyColumns : editableColumns
  const columnIds = columns.map((c) => c.id!)
  // Collapsed Phases are the ones the table doesn't expand.
  const expanded: Record<string, boolean> = Object.fromEntries(
    phases
      .filter((p) => !collapsed.has(p.id))
      .map((p) => [phaseRowId(p.id), true])
  )
  const onExpandedChange = (
    updater: ExpandedState | ((old: ExpandedState) => ExpandedState)
  ) => {
    const next = resolveUpdater<ExpandedState>(updater, expanded)
    for (const phase of phases) {
      const open = next === true || Boolean(next[phaseRowId(phase.id)])
      if (open === collapsed.has(phase.id)) actions.onToggleCollapsed(phase.id)
    }
  }

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
        tints: phaseTints(phases),
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
        <DataTableRoot
          columns={columns}
          data={tree}
          getRowId={rowIdOf}
          getSubRows={subRowsOf}
          config={{
            enableExpanding: true,
            enableRowSelection: readOnly ? false : selectableRows(canSelect),
            enableSorting: false,
            enablePagination: false,
            enableFilters: false,
          }}
          state={{ rowSelection: selection, expanded }}
          onRowSelectionChange={(updater) =>
            onSelectionChange(resolveUpdater(updater, selection))
          }
          onExpandedChange={onExpandedChange}
        >
          <RowContextMenuArea<GridRow>
            menu={readOnly ? noRowMenu : rowMenuOf}
            contentClassName={(row) => (row.kind === "phase" ? "w-56" : "w-52")}
          >
            <DataTable className={LIST_TABLE_CLASS}>
              <DataTableHeader sticky={false} />
              <LineItemsBody
                columnIds={columnIds}
                hintFor={hintFor}
                dragging={drag !== null}
              />
            </DataTable>
          </RowContextMenuArea>
        </DataTableRoot>
        <DragOverlay dropAnimation={null}>
          {overlayLabel !== null && (
            <div className="flex w-fit items-center gap-2 rounded-md border bg-popover px-3 py-1.5 text-sm font-medium shadow-float">
              <GripVerticalIcon className="size-4 text-muted-foreground" />
              {overlayLabel}
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </GridContext>
  )
}
