"use client"

import {
  CalendarX2Icon,
  CopyIcon,
  ExternalLinkIcon,
  Trash2Icon,
} from "lucide-react"
import Link from "next/link"
import { createContext, useContext } from "react"

import type { RouterOutputs } from "@workspace/api"
import { TIME_PERIOD_LABELS } from "@workspace/domain/enums"
import {
  RowMenuItem,
  RowMenuSeparator,
  useDataTableRow,
} from "@workspace/ui/components/niko-table/components/data-table-row-menu"
import { createDataTableColumnHelper } from "@workspace/ui/components/niko-table/lib/data-table-features"
import type { DataTableColumns } from "@workspace/ui/components/niko-table/types"

import {
  actionsColumn,
  ColumnTitle,
  selectColumn,
  SortableColumnTitle,
} from "@/components/shell/data-table"
import { formatDate } from "@/lib/format"
import { formatMoney } from "@/lib/money"

import { QuoteStatusBadge } from "./quote-status-badge"

export type QuoteListRow = RouterOutputs["quote"]["list"]["rows"][number]

const helper = createDataTableColumnHelper<QuoteListRow>()

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

/**
 * A Quote's actions: Open, Clone, and Delete when the row's `canDelete`.
 * The same component is the "…" menu and the right-click menu.
 */
export function QuoteRowMenu() {
  const actions = useContext(QuoteRowActionsContext)!
  const quote = useDataTableRow<QuoteListRow>()
  return (
    <>
      <RowMenuItem render={<Link href={`/quotes/${quote.id}`} />}>
        <ExternalLinkIcon />
        Open
      </RowMenuItem>
      <RowMenuItem onClick={() => actions.onClone(quote)}>
        <CopyIcon />
        Clone
      </RowMenuItem>
      {quote.canDelete && (
        <>
          <RowMenuSeparator />
          <RowMenuItem
            variant="destructive"
            onClick={() => actions.onDelete(quote)}
          >
            <Trash2Icon />
            Delete
          </RowMenuItem>
        </>
      )}
    </>
  )
}

/** The bulk-select column: always first, never in the Columns menu. */
export const QUOTE_SELECT_COLUMN = "select"
/** The row menu column: always last, never in the Columns menu. */
export const QUOTE_ACTIONS_COLUMN = "actions"

/** Column id → its name in the header and the Columns menu. */
export const QUOTE_COLUMN_LABELS = {
  name: "Name",
  account: "Account",
  status: "Status",
  total: "Total",
  owner: "Owner",
  startDate: "Start",
  endDate: "End",
  validUntil: "Valid Until",
  timePeriod: "Time period",
  description: "Description",
  createdAt: "Created",
  updatedAt: "Updated",
} as const
export type QuoteColumnId = keyof typeof QUOTE_COLUMN_LABELS

/** Always shown and first (after the select column). */
export const FIXED_QUOTE_COLUMNS: readonly QuoteColumnId[] = ["name"]
/**
 * Hidden until the user shows them. Of the dates only Valid Until shows by
 * default (it flags lapsed offers); Start, End, Created and Updated are a
 * Columns-menu choice, so a row doesn't read as a wall of dates.
 */
export const DEFAULT_HIDDEN_QUOTE_COLUMNS: readonly QuoteColumnId[] = [
  "description",
  "startDate",
  "endDate",
  "timePeriod",
  "createdAt",
  "updatedAt",
]

const label = (id: QuoteColumnId) => ({ label: QUOTE_COLUMN_LABELS[id] })

const dateCell = (value: string | Date | null) =>
  value ? formatDate(value) : <span className="text-muted-foreground">—</span>

/**
 * Every Quote list column, in default order: the select column first and
 * the row menu last (both outside the saved layout), the data columns in
 * between. Sortable headers sort on the server (`quote.list`'s `sort`).
 */
export const quoteColumns: DataTableColumns<QuoteListRow> = [
  selectColumn<QuoteListRow>({
    allLabel: "Select all Quotes on this page",
    rowLabel: (quote) => `Select ${quote.name}`,
  }),
  helper.accessor("name", {
    id: "name",
    header: SortableColumnTitle,
    enableHiding: false,
    meta: label("name"),
    cell: ({ row }) => (
      <Link
        href={`/quotes/${row.original.id}`}
        title={row.original.description ?? undefined}
        className="block max-w-80 truncate font-medium underline-offset-4 hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  }),
  helper.accessor((r) => r.account.name, {
    id: "account",
    header: SortableColumnTitle,
    meta: label("account"),
  }),
  helper.accessor("status", {
    id: "status",
    header: SortableColumnTitle,
    meta: label("status"),
    cell: ({ row }) => <QuoteStatusBadge status={row.original.status} />,
  }),
  helper.accessor("total", {
    id: "total",
    header: SortableColumnTitle,
    meta: { ...label("total"), align: "end" },
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {formatMoney(row.original.total, row.original.currencyCode)}
      </div>
    ),
  }),
  helper.accessor((r) => r.owner.name ?? r.owner.email, {
    id: "owner",
    header: SortableColumnTitle,
    meta: label("owner"),
  }),
  helper.accessor("startDate", {
    id: "startDate",
    header: SortableColumnTitle,
    meta: label("startDate"),
    cell: ({ row }) => dateCell(row.original.startDate),
  }),
  helper.accessor("endDate", {
    id: "endDate",
    header: SortableColumnTitle,
    meta: label("endDate"),
    cell: ({ row }) => dateCell(row.original.endDate),
  }),
  helper.accessor("validUntil", {
    id: "validUntil",
    header: SortableColumnTitle,
    meta: label("validUntil"),
    cell: ({ row }) =>
      row.original.validUntilPassed ? (
        <span
          className="inline-flex items-center gap-1 font-medium text-danger-ink"
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
    header: SortableColumnTitle,
    meta: label("timePeriod"),
    cell: ({ row }) => TIME_PERIOD_LABELS[row.original.timePeriod],
  }),
  helper.accessor("description", {
    id: "description",
    header: ColumnTitle,
    enableSorting: false,
    meta: label("description"),
    cell: ({ row }) => (
      <span className="block max-w-64 truncate text-muted-foreground">
        {row.original.description}
      </span>
    ),
  }),
  helper.accessor("createdAt", {
    id: "createdAt",
    header: SortableColumnTitle,
    meta: label("createdAt"),
    cell: ({ row }) => dateCell(row.original.createdAt),
  }),
  helper.accessor("updatedAt", {
    id: "updatedAt",
    header: SortableColumnTitle,
    meta: label("updatedAt"),
    cell: ({ row }) => dateCell(row.original.updatedAt),
  }),
  actionsColumn<QuoteListRow>({
    label: (quote) => `Actions for ${quote.name}`,
    Menu: QuoteRowMenu,
    menuClassName: "w-44",
  }),
]

export const QUOTE_COLUMN_IDS = Object.keys(
  QUOTE_COLUMN_LABELS
) as QuoteColumnId[]
