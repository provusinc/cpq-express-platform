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
import { EllipsisIcon } from "lucide-react"
import { useMemo, useRef, useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@workspace/ui/components/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  DataTableColumnHeader,
  useColumnHeaderContext,
} from "@workspace/ui/components/niko-table/components/data-table-column-header"
import { DataTableColumnSortOptions } from "@workspace/ui/components/niko-table/components/data-table-column-sort"
import { DataTableColumnTitle } from "@workspace/ui/components/niko-table/components/data-table-column-title"
import { DataTablePagination } from "@workspace/ui/components/niko-table/components/data-table-pagination"
import { DataTableRowMenuScope } from "@workspace/ui/components/niko-table/components/data-table-row-menu"
import { SORT_ICONS } from "@workspace/ui/components/niko-table/config/data-table"
import { FILTER_VARIANTS } from "@workspace/ui/components/niko-table/lib/constants"
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
  DataTableRow,
} from "@workspace/ui/components/niko-table/types"
import { cn } from "@workspace/ui/lib/utils"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/shell/empty"

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
      <ColumnSortMenu />
    </DataTableColumnHeader>
  )
}

/**
 * niko's column sort menu (asc / desc / clear) as niko's `TableColumnSortMenu`
 * draws it, composed here from its `DataTableColumnSortOptions` so the
 * options' label sits inside a `DropdownMenuGroup` (Base UI throws on a
 * group label outside a group, which niko's own menu does).
 */
function ColumnSortMenu() {
  const { column } = useColumnHeaderContext(true)
  if (!column.getCanSort()) return null
  const sorted = column.getIsSorted()
  const variant = column.columnDef.meta?.variant ?? FILTER_VARIANTS.TEXT
  const icons =
    SORT_ICONS[variant as keyof typeof SORT_ICONS] ??
    SORT_ICONS[FILTER_VARIANTS.TEXT]
  const SortIcon =
    sorted === "asc"
      ? icons.asc
      : sorted === "desc"
        ? icons.desc
        : icons.unsorted
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "size-7 transition-opacity dark:text-muted-foreground",
              sorted && "text-primary"
            )}
          />
        }
      >
        <SortIcon className="size-4" />
        <span className="sr-only">Sort column</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DataTableColumnSortOptions withSeparator={false} />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
  const showFiltered = filtered && empty.filteredTitle !== undefined
  const table = (
    <DataTable
      maxHeight={maxHeight}
      className={cn(LIST_TABLE_CLASS, className)}
    >
      <DataTableHeader />
      <DataTableBody>
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
  if (!RowMenu) return table
  return (
    <RowContextMenuArea menu={() => <RowMenu />}>{table}</RowContextMenuArea>
  )
}

/**
 * Right-click menus for the rows of the table inside it (every `<tr
 * data-row-id>`, as niko's bodies render them): one shadcn `ContextMenu`
 * around the table that opens for the row under the pointer, with `menu`'s
 * items inside a `DataTableRowMenuScope` (so `RowMenuItem` & co. and
 * `useDataTableRow()` work as in the "…" menu). Right-clicking outside a
 * row keeps the browser's menu. The row is highlighted while its menu is
 * open (`data-context-menu-open`).
 *
 * Use this instead of niko's per-row `DataTableRowContextMenu` (and the
 * bodies' `renderRowContextMenu`): its trigger is a `<div>` around the
 * `<tr>`, which is invalid inside `<tbody>`.
 */
export function RowContextMenuArea<TData extends RowData>({
  menu,
  contentClassName,
  children,
}: {
  /** The row's menu items, or `null` for no menu on that row. */
  menu: (row: TData) => React.ReactNode
  contentClassName?: string | ((row: TData) => string | undefined)
  children: React.ReactNode
}) {
  const { table } = useDataTable<TData>()
  const [target, setTarget] = useState<{ row: TData; items: React.ReactNode }>()
  const rowElement = useRef<HTMLElement | null>(null)

  function onContextMenuCapture(event: React.MouseEvent) {
    const element = (event.target as HTMLElement).closest<HTMLElement>(
      "tr[data-row-id]"
    )
    const id = element?.dataset.rowId
    const row = id ? table.getRow(id, true)?.original : undefined
    const items = row === undefined ? null : menu(row)
    if (row === undefined || items === null) {
      // Not a row (or a row without a menu): leave the browser's menu.
      event.stopPropagation()
      return
    }
    rowElement.current?.removeAttribute("data-context-menu-open")
    rowElement.current = element
    element?.setAttribute("data-context-menu-open", "")
    setTarget({ row, items })
  }

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) return
        rowElement.current?.removeAttribute("data-context-menu-open")
        rowElement.current = null
      }}
    >
      <ContextMenuTrigger
        className="select-auto"
        onContextMenuCapture={onContextMenuCapture}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        className={
          target &&
          (typeof contentClassName === "function"
            ? contentClassName(target.row)
            : contentClassName)
        }
      >
        {target && (
          <DataTableRowMenuScope row={target.row} surface="context">
            {target.items}
          </DataTableRowMenuScope>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

/**
 * A per-row "may this row be selected" rule for `DataTableRoot`'s
 * `config.enableRowSelection`. niko types that option as a boolean but
 * hands it to TanStack's `enableRowSelection` unchanged, which takes a
 * predicate too (its top-level `enableRowSelection` prop is overwritten by
 * the config, so it can't carry one).
 */
export function selectableRows<TData extends RowData>(
  canSelect: (row: DataTableRow<TData>) => boolean
): boolean {
  return canSelect as unknown as boolean
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
