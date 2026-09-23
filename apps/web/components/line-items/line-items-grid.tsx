"use client"

import {
  createColumnHelper,
  rowSelectionFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table"
import type { CellContext, RowSelectionState } from "@tanstack/react-table"
import { CalendarClockIcon, RotateCcwIcon, Trash2Icon } from "lucide-react"
import { createContext, useContext } from "react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
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

import type { EditorLine } from "@/components/quotes/autosave"
import { InlineDate } from "@/components/quotes/inline-date"
import { InlineText } from "@/components/quotes/inline-text"
import { useLabels } from "@/components/shell/labels"
import { formatMoney, isMoneyInput, trimMoney } from "@/lib/money"

/** Quantity as typed: digits with up to 3 decimals. */
const QUANTITY_INPUT = /^\d{1,15}(\.\d{1,3})?$/

/**
 * The Line Items grid's features: row selection for bulk delete (and, with
 * #14, bulk move). Server order (Phase, sequence) is kept as given.
 */
const lineItemFeatures = tableFeatures({ rowSelectionFeature })
const helper = createColumnHelper<typeof lineItemFeatures, EditorLine>()

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

const UNIT_LABELS = { each: "Each", hour: "Hour" } as const

/** What the cells need besides their row; provided by `LineItemsGrid`. */
interface GridContextValue {
  currency: string
  quoteStartDate: string
  quoteEndDate: string
  readOnly: boolean
  onUpdate: (patch: LineItemPatch) => void
  onDelete: (ids: string[]) => void
}

const GridContext = createContext<GridContextValue | null>(null)
const useGrid = () => useContext(GridContext)!

type Cell = CellContext<typeof lineItemFeatures, EditorLine, unknown>

// Cells are module-level components reading `GridContext`, so the column
// definitions never change identity and an edit cell keeps its focus and
// draft across re-renders (polling, other commands settling).

function NameCell({ row }: Cell) {
  const { readOnly, onUpdate } = useGrid()
  const labels = useLabels()
  const line = row.original
  return (
    <div className="flex min-w-48 flex-col">
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
  return (
    <InlineText
      label="Notes"
      value={row.original.notes}
      maxLength={2000}
      disabled={readOnly}
      placeholder={readOnly ? "" : "Add notes"}
      className="min-w-40 text-sm"
      onSave={(notes) => onUpdate({ id: row.original.id, notes })}
    />
  )
}

function StartCell({ row }: Cell) {
  const { readOnly, onUpdate, quoteStartDate } = useGrid()
  const line = row.original
  return (
    <InlineDate
      label="Start date"
      value={line.startDate}
      min={quoteStartDate}
      max={line.endDate}
      disabled={readOnly || line.plannerManaged}
      onSave={(startDate) => onUpdate({ id: line.id, startDate })}
    />
  )
}

function EndCell({ row }: Cell) {
  const { readOnly, onUpdate, quoteEndDate } = useGrid()
  const line = row.original
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
  return (
    <InlineText
      label="Quantity"
      value={trimMoney(row.original.quantity)}
      required
      inputMode="decimal"
      disabled={readOnly}
      validate={(v) =>
        QUANTITY_INPUT.test(v)
          ? null
          : "Enter a quantity of 0 or more with up to 3 decimals."
      }
      className="w-24 text-right tabular-nums"
      onSave={(quantity) =>
        quantity && onUpdate({ id: row.original.id, quantity })
      }
    />
  )
}

function UnitPriceCell({ row }: Cell) {
  const { readOnly, onUpdate, currency } = useGrid()
  const line = row.original
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
        onSave={(unitPrice) => unitPrice && onUpdate({ id: line.id, unitPrice })}
      />
    </div>
  )
}

function LineTotalCell({ row }: Cell) {
  const { currency } = useGrid()
  return (
    <div className="px-2 text-right font-medium tabular-nums">
      {formatMoney(row.original.lineTotal, currency)}
    </div>
  )
}

function MarginCell({ row }: Cell) {
  const pct = row.original.lineMarginPct
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

function DeleteCell({ row }: Cell) {
  const { onDelete } = useGrid()
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Delete ${row.original.name}`}
      onClick={() => onDelete([row.original.id])}
    >
      <Trash2Icon />
    </Button>
  )
}

const right = (label: string) => {
  function RightHeader() {
    return <div className="text-right">{label}</div>
  }
  return RightHeader
}

const dataColumns = [
  helper.accessor("name", { id: "name", header: "Name", cell: NameCell }),
  helper.accessor("notes", { id: "notes", header: "Notes", cell: NotesCell }),
  helper.accessor("startDate", {
    id: "startDate",
    header: "Start",
    cell: StartCell,
  }),
  helper.accessor("endDate", { id: "endDate", header: "End", cell: EndCell }),
  helper.accessor("quantity", {
    id: "quantity",
    header: right("Quantity"),
    cell: QuantityCell,
  }),
  helper.accessor("billingUnit", {
    id: "unit",
    header: "Unit",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {UNIT_LABELS[row.original.billingUnit]}
      </span>
    ),
  }),
  helper.accessor("unitPrice", {
    id: "unitPrice",
    header: right("Unit price"),
    cell: UnitPriceCell,
  }),
  helper.accessor("lineTotal", {
    id: "lineTotal",
    header: right("Line total"),
    cell: LineTotalCell,
  }),
  helper.accessor("lineMarginPct", {
    id: "lineMarginPct",
    header: right("Margin"),
    cell: MarginCell,
  }),
]

/** Read-only grid: just the data columns. */
const readOnlyColumns = helper.columns(dataColumns)

/** Editable grid: a select column first and a delete column last. */
const editableColumns = helper.columns([
  helper.display({
    id: "select",
    header: ({ table }) => (
      <Checkbox
        aria-label="Select all Line Items"
        checked={table.getIsAllRowsSelected()}
        indeterminate={
          table.getIsSomeRowsSelected() && !table.getIsAllRowsSelected()
        }
        onCheckedChange={(checked) =>
          table.toggleAllRowsSelected(checked === true)
        }
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label={`Select ${row.original.name}`}
        checked={row.getIsSelected()}
        onCheckedChange={(checked) => row.toggleSelected(checked === true)}
      />
    ),
  }),
  ...dataColumns,
  helper.display({
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: DeleteCell,
  }),
])

/**
 * The Line Items grid (TanStack Table): name, notes, start and end dates,
 * quantity, unit, unit price (marked when it overrides the Base Rate, with
 * a reset), line total and line margin. Every editable cell autosaves
 * through `onUpdate` (text on blur/Enter, Escape reverts); `readOnly`
 * (locked Quote or no edit permission) disables every cell and drops the
 * select and delete columns.
 */
export function LineItemsGrid({
  lines,
  currency,
  quoteStartDate,
  quoteEndDate,
  readOnly,
  selection,
  onSelectionChange,
  onUpdate,
  onDelete,
}: {
  lines: EditorLine[]
  currency: string
  quoteStartDate: string
  quoteEndDate: string
  readOnly: boolean
  selection: RowSelectionState
  onSelectionChange: (selection: RowSelectionState) => void
  onUpdate: (patch: LineItemPatch) => void
  onDelete: (ids: string[]) => void
}) {
  const table = useTable({
    features: lineItemFeatures,
    columns: readOnly ? readOnlyColumns : editableColumns,
    data: lines,
    getRowId: (row) => row.id,
    enableRowSelection: !readOnly,
    state: { rowSelection: selection },
    onRowSelectionChange: (updater) =>
      onSelectionChange(
        typeof updater === "function" ? updater(selection) : updater
      ),
  })

  return (
    <GridContext
      value={{
        currency,
        quoteStartDate,
        quoteEndDate,
        readOnly,
        onUpdate,
        onDelete,
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
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() ? "selected" : undefined}
              >
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id} className="py-1">
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </GridContext>
  )
}
