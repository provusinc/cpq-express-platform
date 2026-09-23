"use client"

/**
 * The app's conventions on top of niko-table (vendored in
 * `@workspace/ui/components/niko-table`): column headers, the select and
 * row-menu columns, the table body with its loading and empty states, and
 * server-side paging. Every list builds on these so they look and behave
 * the same; see "Tables" in AGENTS.md.
 */
import type {
  ColumnFiltersState,
  ColumnOrderState,
  ColumnVisibilityState,
  PaginationState,
  RowData,
  RowSelectionState,
  SortingState,
  TableFeatures,
  Updater,
} from "@tanstack/react-table"
import { ChevronsUpDownIcon, Columns3Icon, EllipsisIcon } from "lucide-react"
import { useCallback, useMemo } from "react"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { DataTableColumnHeader } from "@workspace/ui/components/niko-table/components/data-table-column-header"
import { DataTableColumnSortMenu } from "@workspace/ui/components/niko-table/components/data-table-column-sort"
import { DataTableColumnTitle } from "@workspace/ui/components/niko-table/components/data-table-column-title"
import { DataTablePagination } from "@workspace/ui/components/niko-table/components/data-table-pagination"
import { DataTableViewMenu } from "@workspace/ui/components/niko-table/components/data-table-view-menu"
import { DataTableRowMenuScope } from "@workspace/ui/components/niko-table/components/data-table-row-menu"
import { DataTable } from "@workspace/ui/components/niko-table/core/data-table"
import { useDataTable } from "@workspace/ui/components/niko-table/core/data-table-context"
import { DataTableRoot } from "@workspace/ui/components/niko-table/core/data-table-root"
import {
  DataTableBody,
  DataTableEmptyBody,
  DataTableHeader,
  DataTableSkeleton,
} from "@workspace/ui/components/niko-table/core/data-table-structure"
import type {
  DataTableColumnDef,
  DataTableColumns,
} from "@workspace/ui/components/niko-table/types"
import { cn } from "@workspace/ui/lib/utils"

declare module "@tanstack/react-table" {
  // Must repeat niko-table's augmentation's type parameters verbatim.
  /* eslint-disable @typescript-eslint/no-unused-vars */
  interface ColumnMeta<
    TFeatures extends TableFeatures,
    TData extends RowData,
    TValue,
  > {
    /** `"end"` right-aligns the header title (numbers, money). */
    align?: "start" | "end"
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
}

/** Applies a TanStack `Updater` (value or function of the current value). */
export const resolveUpdater = <T,>(updater: Updater<T>, current: T): T =>
  typeof updater === "function" ? (updater as (old: T) => T)(current) : updater

/** Page sizes every server-paged list offers (the API allows up to 100). */
export const PAGE_SIZE_OPTIONS = [25, 50, 100]

/** What a header function gets that the title headers read. */
interface HeaderProps {
  column: { columnDef: { meta?: { align?: "start" | "end" } } }
}

// Headers must not call hooks: niko's DataTableRoot calls each `header`
// function once on mount to detect features, inside its own render, so a
// hook there corrupts its hook order. Read the column from the props.

/**
 * A column header showing `meta.label`. Use as `header: ColumnTitle` so the
 * definition stays module-level and stable.
 */
export function ColumnTitle({ column }: HeaderProps) {
  const end = column.columnDef.meta?.align === "end"
  return (
    <DataTableColumnHeader className={end ? "justify-end" : undefined}>
      <DataTableColumnTitle className={end ? "text-right" : undefined} />
    </DataTableColumnHeader>
  )
}

/** A header with `meta.label` and niko's sort menu (asc / desc / clear). */
export function SortableColumnTitle({ column }: HeaderProps) {
  const end = column.columnDef.meta?.align === "end"
  return (
    <DataTableColumnHeader className={end ? "justify-end" : undefined}>
      <DataTableColumnTitle />
      <DataTableColumnSortMenu />
    </DataTableColumnHeader>
  )
}

/** A header with no visible text (select and row-menu columns). */
function hiddenHeader(label: string) {
  function HiddenHeader() {
    return <span className="sr-only">{label}</span>
  }
  return HiddenHeader
}

/**
 * The bulk-select column (id `select`, niko's system column): a page-level
 * select-all checkbox and one per row. Call at module level.
 */
export function selectColumn<TData extends RowData>({
  allLabel,
  rowLabel,
}: {
  /** e.g. "Select all Quotes on this page". */
  allLabel: string
  /** e.g. (quote) => `Select ${quote.name}`. */
  rowLabel: (row: TData) => string
}): DataTableColumnDef<TData> {
  return {
    id: "select",
    size: 40,
    enableHiding: false,
    enableSorting: false,
    header: ({ table }) => (
      <Checkbox
        aria-label={allLabel}
        checked={table.getIsAllRowsSelected()}
        indeterminate={
          table.getIsSomeRowsSelected() && !table.getIsAllRowsSelected()
        }
        onCheckedChange={(checked) =>
          table.toggleAllRowsSelected(checked === true)
        }
      />
    ),
    cell: ({ row }) =>
      row.getCanSelect() ? (
        <Checkbox
          aria-label={rowLabel(row.original)}
          checked={row.getIsSelected()}
          onCheckedChange={(checked) => row.toggleSelected(checked === true)}
        />
      ) : null,
  }
}

/**
 * The row-menu column (id `actions`): a "…" button opening `Menu`, the
 * row's actions written once with niko's `RowMenuItem` & co. (the same
 * component is the row's right-click menu, see `ListTable`'s `rowMenu`).
 * `Menu` reads its row with `useDataTableRow()`. Call at module level.
 */
export function actionsColumn<TData extends RowData>({
  label,
  Menu,
  menuClassName = "w-48",
}: {
  /** The trigger's accessible name, e.g. (quote) => `Actions for ${quote.name}`. */
  label: (row: TData) => string
  Menu: React.ComponentType
  menuClassName?: string
}): DataTableColumnDef<TData> {
  return {
    id: "actions",
    size: 48,
    enableHiding: false,
    enableSorting: false,
    header: hiddenHeader("Actions"),
    cell: ({ row }) => (
      <RowActionsMenu
        row={row.original}
        label={label(row.original)}
        className={menuClassName}
      >
        <Menu />
      </RowActionsMenu>
    ),
  }
}

/** A "…" dropdown whose content is a row menu (`RowMenuItem` & co.). */
export function RowActionsMenu({
  row,
  label,
  className,
  disabled,
  children,
}: {
  row: unknown
  label: string
  className?: string
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label={label}
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={className}>
        <DataTableRowMenuScope row={row} surface="dropdown">
          {children}
        </DataTableRowMenuScope>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** What an empty list says (and, when filters are on, what it says then). */
export interface ListEmpty {
  icon: React.ReactNode
  title: string
  description?: React.ReactNode
  filteredTitle?: string
  filteredDescription?: React.ReactNode
}

/**
 * The list look shared with the Line Items grid: a quiet tinted header
 * row with small muted titles, hairline row rules, hover tint.
 */
export const LIST_TABLE_CLASS =
  "bg-background [&_thead_tr]:bg-muted/60 [&_thead_th]:h-9 [&_thead_th]:text-xs [&_thead_th]:font-medium [&_thead_th]:text-muted-foreground [&_tbody_tr]:transition-colors"

/**
 * The table itself, inside a `DataTableRoot` (or `ServerTableRoot`):
 * header, rows, skeleton rows while the first page loads and the empty
 * state. `rowMenu` is the row's right-click menu (the same component as its
 * "…" menu); `filtered` picks the "no matches" wording.
 */
export function ListTable({
  empty,
  filtered = false,
  rowMenu: RowMenu,
  skeletonRows = 5,
  maxHeight,
  className,
}: {
  empty: ListEmpty
  filtered?: boolean
  rowMenu?: React.ComponentType
  skeletonRows?: number
  maxHeight?: number | string
  className?: string
}) {
  const renderRowContextMenu = useCallback(
    () => (RowMenu ? <RowMenu /> : null),
    [RowMenu]
  )
  const showFiltered = filtered && empty.filteredTitle !== undefined
  return (
    <DataTable
      maxHeight={maxHeight}
      className={cn(LIST_TABLE_CLASS, className)}
    >
      <DataTableHeader />
      <DataTableBody
        renderRowContextMenu={RowMenu ? renderRowContextMenu : undefined}
      >
        <DataTableSkeleton rows={skeletonRows} />
        <DataTableEmptyBody>
          <Empty className="py-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">{empty.icon}</EmptyMedia>
              <EmptyTitle>
                {showFiltered ? empty.filteredTitle : empty.title}
              </EmptyTitle>
              {(showFiltered
                ? empty.filteredDescription
                : empty.description) && (
                <EmptyDescription>
                  {showFiltered ? empty.filteredDescription : empty.description}
                </EmptyDescription>
              )}
            </EmptyHeader>
          </Empty>
        </DataTableEmptyBody>
      </DataTableBody>
    </DataTable>
  )
}

/**
 * niko's pagination for a server-paged list ("1-25 of 80 items", page
 * size, page number, previous/next). Hidden while the list is empty.
 */
export function ServerPagination({
  total,
  isFetching,
}: {
  total: number
  isFetching?: boolean
}) {
  const { table } = useDataTable()
  if (total === 0) return null
  return (
    <DataTablePagination
      totalCount={total}
      pageSizeOptions={PAGE_SIZE_OPTIONS}
      defaultPageSize={table.state.pagination.pageSize}
      isFetching={isFetching}
      isLoading={false}
    />
  )
}

/** What a server-paged list's query returns. */
export interface ServerPage<TData> {
  rows: TData[]
  total: number
  page: number
  pageSize: number
}

/**
 * `DataTableRoot` for a list the server pages, sorts and filters: the rows
 * shown are exactly the page the API returned, and every table state
 * change is handed back to the caller to become the next query input
 * (`onPageChange` with 1-based `page`). Pass `sorting`/`columnFilters`/
 * `globalFilter` only for what the API supports; selection, column
 * visibility and order are optional and controlled.
 */
export function ServerTableRoot<TData extends RowData>({
  columns,
  data,
  isLoading,
  page,
  pageSize,
  total,
  onPageChange,
  sorting,
  onSortingChange,
  columnFilters,
  onColumnFiltersChange,
  globalFilter,
  onGlobalFilterChange,
  rowSelection,
  onRowSelectionChange,
  columnVisibility,
  onColumnVisibilityChange,
  columnOrder,
  onColumnOrderChange,
  getRowId,
  className,
  children,
}: {
  columns: DataTableColumns<TData>
  data: TData[] | undefined
  /** The first page is loading (show skeleton rows). */
  isLoading: boolean
  page: number
  pageSize: number
  total: number
  onPageChange: (paging: { page: number; pageSize: number }) => void
  sorting?: SortingState
  onSortingChange?: (sorting: SortingState) => void
  columnFilters?: ColumnFiltersState
  onColumnFiltersChange?: (filters: ColumnFiltersState) => void
  globalFilter?: string
  onGlobalFilterChange?: (value: string) => void
  rowSelection?: RowSelectionState
  onRowSelectionChange?: (selection: RowSelectionState) => void
  columnVisibility?: ColumnVisibilityState
  onColumnVisibilityChange?: (visibility: ColumnVisibilityState) => void
  columnOrder?: ColumnOrderState
  onColumnOrderChange?: (order: ColumnOrderState) => void
  getRowId?: (row: TData) => string
  className?: string
  children: React.ReactNode
}) {
  const pagination: PaginationState = useMemo(
    () => ({ pageIndex: page - 1, pageSize }),
    [page, pageSize]
  )
  const state = useMemo(
    () => ({
      pagination,
      ...(sorting ? { sorting } : {}),
      ...(columnFilters ? { columnFilters } : {}),
      ...(globalFilter !== undefined ? { globalFilter } : {}),
      ...(rowSelection ? { rowSelection } : {}),
      ...(columnVisibility ? { columnVisibility } : {}),
      ...(columnOrder ? { columnOrder } : {}),
    }),
    [
      pagination,
      sorting,
      columnFilters,
      globalFilter,
      rowSelection,
      columnVisibility,
      columnOrder,
    ]
  )
  return (
    <DataTableRoot
      className={className}
      columns={columns}
      data={data ?? EMPTY}
      isLoading={isLoading}
      getRowId={getRowId ?? defaultRowId}
      config={{
        enablePagination: true,
        manualPagination: true,
        pageCount: Math.max(1, Math.ceil(total / pageSize)),
        enableSorting: Boolean(onSortingChange),
        manualSorting: true,
        enableMultiSort: false,
        enableFilters: Boolean(onColumnFiltersChange || onGlobalFilterChange),
        manualFiltering: true,
        enableRowSelection: Boolean(onRowSelectionChange),
      }}
      enableSortingRemoval={false}
      state={state}
      onPaginationChange={(updater) => {
        const next = resolveUpdater(updater, pagination)
        onPageChange({ page: next.pageIndex + 1, pageSize: next.pageSize })
      }}
      onSortingChange={
        onSortingChange &&
        ((updater) => onSortingChange(resolveUpdater(updater, sorting ?? [])))
      }
      onColumnFiltersChange={
        onColumnFiltersChange &&
        ((updater) =>
          onColumnFiltersChange(resolveUpdater(updater, columnFilters ?? [])))
      }
      onGlobalFilterChange={
        onGlobalFilterChange &&
        ((value) =>
          onGlobalFilterChange(typeof value === "string" ? value : ""))
      }
      onRowSelectionChange={
        onRowSelectionChange &&
        ((updater) =>
          onRowSelectionChange(resolveUpdater(updater, rowSelection ?? {})))
      }
      onColumnVisibilityChange={
        onColumnVisibilityChange &&
        ((updater) =>
          onColumnVisibilityChange(
            resolveUpdater(updater, columnVisibility ?? {})
          ))
      }
      onColumnOrderChange={
        onColumnOrderChange &&
        ((updater) =>
          onColumnOrderChange(resolveUpdater(updater, columnOrder ?? [])))
      }
    >
      {children}
    </DataTableRoot>
  )
}

const EMPTY: never[] = []
const defaultRowId = (row: unknown) => (row as { id: string }).id

/**
 * The value a niko faceted filter keeps for a column: a plain `string[]`
 * or its `{ value }` filter object. Read it back into query input.
 */
export function facetValues(
  filters: ColumnFiltersState,
  columnId: string
): string[] {
  const entry = filters.find((f) => f.id === columnId)?.value
  if (entry === undefined || entry === null) return []
  const value =
    typeof entry === "object" && !Array.isArray(entry) && "value" in entry
      ? (entry as { value: unknown }).value
      : entry
  return (Array.isArray(value) ? value : [value]).map(String)
}

/** Column filters from query input: `{ columnId: values }`, empty ones dropped. */
export function toColumnFilters(
  values: Record<string, readonly string[] | string | undefined>
): ColumnFiltersState {
  return Object.entries(values).flatMap(([id, value]) =>
    value === undefined || value.length === 0
      ? []
      : [{ id, value: Array.isArray(value) ? [...value] : [value] }]
  )
}

/**
 * `DataTableRoot` for a list that is fully loaded (no server paging): the
 * rows are all there, so sorting (when `sortable`) happens in the browser.
 * No pagination or filters.
 */
export function LocalTableRoot<TData extends RowData>({
  columns,
  data,
  isLoading = false,
  sortable = false,
  initialSorting,
  getRowId,
  className,
  children,
}: {
  columns: DataTableColumns<TData>
  data: TData[] | undefined
  isLoading?: boolean
  sortable?: boolean
  initialSorting?: SortingState
  getRowId?: (row: TData) => string
  className?: string
  children: React.ReactNode
}) {
  return (
    <DataTableRoot
      className={className}
      columns={columns}
      data={data ?? EMPTY}
      isLoading={isLoading}
      getRowId={getRowId ?? defaultRowId}
      initialState={initialSorting ? { sorting: initialSorting } : undefined}
      config={{
        enablePagination: false,
        enableSorting: sortable,
        enableMultiSort: false,
        enableFilters: false,
        enableRowSelection: false,
      }}
    >
      {children}
    </DataTableRoot>
  )
}

/**
 * The toolbar's "Columns" menu (niko's view menu): show or hide the
 * table's optional columns, e.g. a Description hidden by default. Columns
 * with `enableHiding: false` (the Name, filter-only columns) aren't listed.
 */
export function ColumnsMenu() {
  return (
    <div className="ml-auto">
      <DataTableViewMenu trigger={<ColumnsButton />} />
    </div>
  )
}

/**
 * The trigger of the Columns menus. It is the popover trigger's `render`
 * element, so it must pass the props (handlers, ref, ARIA) it is given on
 * to the button.
 */
export function ColumnsButton(props: React.ComponentProps<typeof Button>) {
  return (
    <Button variant="outline" size="sm" {...props}>
      <Columns3Icon data-icon="inline-start" />
      Columns
      <ChevronsUpDownIcon data-icon="inline-end" className="opacity-50" />
    </Button>
  )
}
