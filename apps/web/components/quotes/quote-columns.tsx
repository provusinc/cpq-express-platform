"use client"

import {
  columnOrderingFeature,
  columnVisibilityFeature,
  createColumnHelper,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
} from "@tanstack/react-table"
import type { CellContext, Column } from "@tanstack/react-table"
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  CalendarX2Icon,
  CopyIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  Trash2Icon,
} from "lucide-react"
import Link from "next/link"
import { createContext, useContext } from "react"

import type { RouterOutputs } from "@workspace/api"
import { TIME_PERIOD_LABELS } from "@workspace/domain/enums"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import { formatDate } from "@/lib/format"
import { formatMoney } from "@/lib/money"

import { QuoteStatusBadge } from "./quote-status-badge"

export type QuoteListRow = RouterOutputs["quote"]["list"]["rows"][number]

/**
 * The Quote list's TanStack Table features: server-side sorting (the API
 * sorts; `manualSorting`), column show/hide and reorder (saved per User),
 * and row selection for bulk delete (the `select` column).
 */
export const quoteTableFeatures = tableFeatures({
  rowSortingFeature,
  columnVisibilityFeature,
  columnOrderingFeature,
  rowSelectionFeature,
})

const helper = createColumnHelper<typeof quoteTableFeatures, QuoteListRow>()

/**
 * The row menu's actions, provided by the list (columns are defined at
 * module level so cells keep a stable identity).
 */
export interface QuoteRowActions {
  onClone: (row: QuoteListRow) => void
  onDelete: (row: QuoteListRow) => void
}

export const QuoteRowActionsContext = createContext<QuoteRowActions | null>(
  null
)

type QuoteCell = CellContext<typeof quoteTableFeatures, QuoteListRow, unknown>

function SelectCell({ row }: QuoteCell) {
  return (
    <Checkbox
      aria-label={`Select ${row.original.name}`}
      checked={row.getIsSelected()}
      onCheckedChange={(checked) => row.toggleSelected(checked === true)}
    />
  )
}

function RowActionsCell({ row }: QuoteCell) {
  const actions = useContext(QuoteRowActionsContext)!
  const quote = row.original
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${quote.name}`}
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem render={<Link href={`/quotes/${quote.id}`} />}>
          <ExternalLinkIcon />
          Open
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => actions.onClone(quote)}>
          <CopyIcon />
          Clone
        </DropdownMenuItem>
        {quote.canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => actions.onDelete(quote)}
            >
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The bulk-select column: always first, never in the Columns dialog. */
export const QUOTE_SELECT_COLUMN = "select"
/** The row menu column: always last, never in the Columns dialog. */
export const QUOTE_ACTIONS_COLUMN = "actions"

/** Column id → its name in the header and the Columns dialog. */
export const QUOTE_COLUMN_LABELS = {
  name: "Name",
  account: "Account",
  status: "Status",
  owner: "Owner",
  startDate: "Start",
  endDate: "End",
  validUntil: "Valid until",
  timePeriod: "Time period",
  total: "Total",
  description: "Description",
  createdAt: "Created",
  updatedAt: "Updated",
} as const
export type QuoteColumnId = keyof typeof QUOTE_COLUMN_LABELS

/** Always shown and first. */
export const FIXED_QUOTE_COLUMNS: readonly QuoteColumnId[] = ["name"]
/** Hidden until the user shows them. */
export const DEFAULT_HIDDEN_QUOTE_COLUMNS: readonly QuoteColumnId[] = [
  "description",
  "timePeriod",
  "updatedAt",
]

/** The part of a sortable column a header needs. */
type SortableColumn = Pick<
  Column<typeof quoteTableFeatures, QuoteListRow, unknown>,
  "getIsSorted" | "getToggleSortingHandler"
>

function SortHeader({
  column,
  label,
  align = "start",
}: {
  column: SortableColumn
  label: string
  align?: "start" | "end"
}) {
  const sorted = column.getIsSorted()
  const Icon =
    sorted === "asc"
      ? ArrowUpIcon
      : sorted === "desc"
        ? ArrowDownIcon
        : ArrowUpDownIcon
  return (
    <Button
      variant="ghost"
      size="sm"
      className={align === "end" ? "-mr-2 ml-auto flex" : "-ml-2"}
      onClick={column.getToggleSortingHandler()}
      aria-label={`Sort by ${label}`}
    >
      {label}
      <Icon
        data-icon="inline-end"
        className={sorted ? undefined : "text-muted-foreground/60"}
      />
    </Button>
  )
}

function header(id: QuoteColumnId, align?: "start" | "end") {
  function QuoteColumnHeader({ column }: { column: SortableColumn }) {
    return (
      <SortHeader
        column={column}
        label={QUOTE_COLUMN_LABELS[id]}
        align={align}
      />
    )
  }
  return QuoteColumnHeader
}

const dateCell = (value: string | Date | null) =>
  value ? formatDate(value) : <span className="text-muted-foreground">—</span>

/**
 * Every Quote list column, in default order: the select column first and
 * the row menu last (both outside the saved layout), the data columns in
 * between.
 */
export const quoteColumns = helper.columns([
  helper.display({
    id: QUOTE_SELECT_COLUMN,
    enableHiding: false,
    header: ({ table }) => (
      <Checkbox
        aria-label="Select all Quotes on this page"
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
  helper.accessor("name", {
    id: "name",
    header: header("name"),
    enableHiding: false,
    cell: ({ row }) => (
      <Link
        href={`/quotes/${row.original.id}`}
        className="font-medium hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  }),
  helper.accessor((r) => r.account.name, {
    id: "account",
    header: header("account"),
  }),
  helper.accessor("status", {
    id: "status",
    header: header("status"),
    cell: ({ row }) => <QuoteStatusBadge status={row.original.status} />,
  }),
  helper.accessor((r) => r.owner.name ?? r.owner.email, {
    id: "owner",
    header: header("owner"),
  }),
  helper.accessor("startDate", {
    id: "startDate",
    header: header("startDate"),
    cell: ({ row }) => dateCell(row.original.startDate),
  }),
  helper.accessor("endDate", {
    id: "endDate",
    header: header("endDate"),
    cell: ({ row }) => dateCell(row.original.endDate),
  }),
  helper.accessor("validUntil", {
    id: "validUntil",
    header: header("validUntil"),
    cell: ({ row }) =>
      row.original.validUntilPassed ? (
        <span
          className="inline-flex items-center gap-1 font-medium text-destructive"
          title="Valid Until has passed. The status doesn't change."
        >
          <CalendarX2Icon className="size-3.5" aria-hidden />
          {formatDate(row.original.validUntil!)}
          <span className="sr-only">(passed)</span>
        </span>
      ) : (
        dateCell(row.original.validUntil)
      ),
  }),
  helper.accessor("timePeriod", {
    id: "timePeriod",
    header: header("timePeriod"),
    cell: ({ row }) => TIME_PERIOD_LABELS[row.original.timePeriod],
  }),
  helper.accessor("total", {
    id: "total",
    header: header("total", "end"),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {formatMoney(row.original.total, row.original.currencyCode)}
      </div>
    ),
  }),
  helper.accessor("description", {
    id: "description",
    header: QUOTE_COLUMN_LABELS.description,
    enableSorting: false,
    cell: ({ row }) => (
      <span className="line-clamp-1 max-w-64 text-muted-foreground">
        {row.original.description}
      </span>
    ),
  }),
  helper.accessor("createdAt", {
    id: "createdAt",
    header: header("createdAt"),
    cell: ({ row }) => dateCell(row.original.createdAt),
  }),
  helper.accessor("updatedAt", {
    id: "updatedAt",
    header: header("updatedAt"),
    cell: ({ row }) => dateCell(row.original.updatedAt),
  }),
  helper.display({
    id: QUOTE_ACTIONS_COLUMN,
    enableHiding: false,
    header: () => <span className="sr-only">Actions</span>,
    cell: RowActionsCell,
  }),
])

export const QUOTE_COLUMN_IDS = Object.keys(
  QUOTE_COLUMN_LABELS
) as QuoteColumnId[]
