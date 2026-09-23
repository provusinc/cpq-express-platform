"use client"

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { useTable } from "@tanstack/react-table"
import type {
  ColumnOrderState,
  ColumnVisibilityState,
  SortingState,
  Updater,
} from "@tanstack/react-table"
import {
  ChevronDownIcon,
  Columns3Icon,
  FileTextIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from "lucide-react"
import { useDeferredValue, useState } from "react"
import { toast } from "sonner"

import { QUOTE_STATUS_LABELS, QUOTE_STATUSES } from "@workspace/domain/enums"
import type { QuoteStatus } from "@workspace/domain/enums"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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
import { Input } from "@workspace/ui/components/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { FilterSelect } from "@/components/shell/filter-select"
import { ListPagination } from "@/components/shell/list-pagination"
import { PageHeader } from "@/components/shell/page-header"
import { resolveColumnLayout, toSavedLayout } from "@/lib/column-layout"
import type { ColumnLayout } from "@/lib/column-layout"
import { errorMessage } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

import { ColumnsDialog } from "./columns-dialog"
import { CreateQuoteDialog } from "./create-quote-dialog"
import { INITIAL_QUOTE_LIST_INPUT } from "./list-input"
import type { QuoteListInput } from "./list-input"
import {
  DEFAULT_HIDDEN_QUOTE_COLUMNS,
  FIXED_QUOTE_COLUMNS,
  QUOTE_COLUMN_IDS,
  QUOTE_COLUMN_LABELS,
  quoteColumns,
  quoteTableFeatures,
} from "./quote-columns"
import type { QuoteListRow } from "./quote-columns"

const EMPTY_ROWS: QuoteListRow[] = []
const OWNER_OPTIONS = [{ value: "mine", label: "My Quotes" }] as const

type Sort = NonNullable<QuoteListInput["sort"]>

const layoutFor = (saved: { order: string[]; hidden: string[] } | null) =>
  resolveColumnLayout(QUOTE_COLUMN_IDS, saved, {
    fixed: FIXED_QUOTE_COLUMNS,
    defaultHidden: DEFAULT_HIDDEN_QUOTE_COLUMNS,
  })

const resolve = <T,>(updater: Updater<T>, current: T): T =>
  typeof updater === "function" ? (updater as (old: T) => T)(current) : updater

/**
 * The Quote list: search, filters (status, Account, created date range,
 * mine/all), server-side sorting and paging, and columns the user shows,
 * hides and reorders (saved to their preferences). Valid Until dates in the
 * past are highlighted. `insights` renders above the filters (Key Insight
 * cards, #25).
 */
export function QuotesList({ insights }: { insights?: React.ReactNode }) {
  const trpc = useTRPC()

  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search.trim())
  const [filters, setFilters] = useState<QuoteListInput>(
    INITIAL_QUOTE_LIST_INPUT
  )
  const input: QuoteListInput = {
    ...filters,
    ...(deferredSearch ? { search: deferredSearch } : {}),
  }
  const list = useQuery({
    ...trpc.quote.list.queryOptions(input),
    placeholderData: keepPreviousData,
  })
  const options = useQuery(trpc.quote.filterOptions.queryOptions())
  const [creating, setCreating] = useState(false)
  const [editingColumns, setEditingColumns] = useState(false)

  const setFilter = (changes: Partial<QuoteListInput>) =>
    setFilters((f) => ({ ...f, ...changes, page: changes.page ?? 1 }))

  // Column layout: the saved preference, applied locally at once and saved.
  const { data: preferences } = useSuspenseQuery(
    trpc.user.preferences.queryOptions()
  )
  const [layout, setLayout] = useState<ColumnLayout>(() =>
    layoutFor(preferences.quoteListColumns)
  )
  const saveLayout = useMutation(
    trpc.user.setQuoteListColumns.mutationOptions({
      onError: (e) => toast.error(errorMessage(e)),
    })
  )
  const changeLayout = (next: ColumnLayout) => {
    setLayout(next)
    saveLayout.mutate(toSavedLayout(next, FIXED_QUOTE_COLUMNS))
  }

  const sort: Sort = filters.sort ?? INITIAL_QUOTE_LIST_INPUT.sort
  const sorting: SortingState = [
    { id: sort.by, desc: sort.direction === "desc" },
  ]

  const table = useTable({
    features: quoteTableFeatures,
    columns: quoteColumns,
    data: list.data?.rows ?? EMPTY_ROWS,
    getRowId: (row) => row.id,
    manualSorting: true,
    enableSortingRemoval: false,
    enableMultiSort: false,
    state: {
      sorting,
      columnVisibility: layout.visibility,
      columnOrder: layout.order,
    },
    onSortingChange: (updater) => {
      const [next] = resolve(updater, sorting)
      if (next) {
        setFilter({
          sort: {
            by: next.id as Sort["by"],
            direction: next.desc ? "desc" : "asc",
          },
        })
      }
    },
    onColumnVisibilityChange: (updater) =>
      changeLayout({
        ...layout,
        visibility: resolve<ColumnVisibilityState>(updater, layout.visibility),
      }),
    onColumnOrderChange: (updater) =>
      changeLayout({
        ...layout,
        order: resolve<ColumnOrderState>(updater, layout.order),
      }),
  })

  const statuses = filters.statuses ?? []
  const toggleStatus = (status: QuoteStatus, checked: boolean) =>
    setFilter({
      statuses: checked
        ? [...statuses, status]
        : statuses.filter((s) => s !== status),
    })

  const filtered =
    Boolean(deferredSearch) ||
    statuses.length > 0 ||
    Boolean(filters.accountId) ||
    Boolean(filters.createdFrom) ||
    Boolean(filters.createdTo) ||
    filters.owner === "mine"
  const clearFilters = () => {
    setSearch("")
    setFilters({ ...INITIAL_QUOTE_LIST_INPUT, sort })
  }

  const rows = table.getRowModel().rows
  const visibleColumns = table.getVisibleLeafColumns().length

  return (
    <>
      <PageHeader
        title="Quotes"
        description="Priced engagements offered to your Accounts."
      >
        <Button onClick={() => setCreating(true)}>
          <PlusIcon data-icon="inline-start" />
          New Quote
        </Button>
      </PageHeader>

      {insights}

      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="w-full sm:w-64">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search Quotes"
            placeholder="Search name, description, Account"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setFilter({})
            }}
          />
        </InputGroup>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" className="w-44 justify-between" />
            }
          >
            {statuses.length === 0
              ? "All statuses"
              : statuses.length === 1
                ? QUOTE_STATUS_LABELS[statuses[0]!]
                : `${statuses.length} statuses`}
            <ChevronDownIcon data-icon="inline-end" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            {QUOTE_STATUSES.map((status) => (
              <DropdownMenuCheckboxItem
                key={status}
                checked={statuses.includes(status)}
                onCheckedChange={(checked) => toggleStatus(status, checked)}
              >
                {QUOTE_STATUS_LABELS[status]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <FilterSelect
          label="Account"
          allLabel="All Accounts"
          className="w-48"
          value={filters.accountId}
          options={(options.data?.accounts ?? []).map((a) => ({
            value: a.id,
            label: a.name,
          }))}
          onChange={(accountId) => setFilter({ accountId })}
        />
        <FilterSelect
          label="Owner"
          allLabel="All Quotes"
          value={filters.owner === "mine" ? "mine" : undefined}
          options={OWNER_OPTIONS}
          onChange={(owner) => setFilter({ owner: owner ? "mine" : "all" })}
        />
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <span>Created</span>
          <Input
            type="date"
            aria-label="Created from"
            className="w-36"
            value={filters.createdFrom ?? ""}
            max={filters.createdTo}
            onChange={(e) =>
              setFilter({ createdFrom: e.target.value || undefined })
            }
          />
          <span>–</span>
          <Input
            type="date"
            aria-label="Created to"
            className="w-36"
            value={filters.createdTo ?? ""}
            min={filters.createdFrom}
            onChange={(e) =>
              setFilter({ createdTo: e.target.value || undefined })
            }
          />
        </div>
        {filtered && (
          <Button variant="ghost" onClick={clearFilters}>
            <XIcon data-icon="inline-start" />
            Clear
          </Button>
        )}
        <Button
          variant="outline"
          className="ml-auto"
          onClick={() => setEditingColumns(true)}
        >
          <Columns3Icon data-icon="inline-start" />
          Columns
        </Button>
      </div>

      {list.isSuccess && list.data.total === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileTextIcon />
            </EmptyMedia>
            <EmptyTitle>
              {filtered ? "No Quotes match" : "No Quotes yet"}
            </EmptyTitle>
            <EmptyDescription>
              {filtered
                ? "Try another search or clear the filters."
                : "Create a Quote for one of your Accounts."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-lg border">
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
              {rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {list.isPending && (
                <TableRow>
                  <TableCell
                    colSpan={visibleColumns}
                    className="h-24 text-center text-muted-foreground"
                  >
                    Loading Quotes…
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {list.data && list.data.total > 0 && (
        <ListPagination
          page={list.data.page}
          pageSize={list.data.pageSize}
          total={list.data.total}
          onPageChange={(page) => setFilter({ page })}
        />
      )}

      <CreateQuoteDialog open={creating} onOpenChange={setCreating} />
      <ColumnsDialog
        open={editingColumns}
        onOpenChange={setEditingColumns}
        layout={layout}
        labels={QUOTE_COLUMN_LABELS}
        fixed={FIXED_QUOTE_COLUMNS}
        onChange={changeLayout}
        onReset={() => changeLayout(layoutFor(null))}
      />
    </>
  )
}
