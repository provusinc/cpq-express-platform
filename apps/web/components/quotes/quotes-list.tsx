"use client"

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type {
  ColumnFiltersState,
  RowSelectionState,
  SortingState,
} from "@tanstack/react-table"
import { FileTextIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useDeferredValue, useMemo, useState } from "react"
import { toast } from "sonner"

import { QUOTE_STATUS_LABELS, QUOTE_STATUSES } from "@workspace/domain/enums"
import type { QuoteStatus } from "@workspace/domain/enums"
import { INSIGHT_LABELS } from "@workspace/domain/insights"
import { Button } from "@workspace/ui/components/button"
import { DataTableSelectionBar } from "@workspace/ui/components/niko-table/components/data-table-selection-bar"
import { DataTableToolbarSection } from "@workspace/ui/components/niko-table/components/data-table-toolbar-section"

import { ConfirmDialog } from "@/components/shell/confirm-dialog"
import {
  facetValues,
  ListTable,
  ServerPagination,
  ServerTableRoot,
  toColumnFilters,
} from "@/components/shell/data-table"
import {
  ColumnsDndMenu,
  DateRangeFilter,
  FacetedFilter,
  SearchFilter,
} from "@/components/shell/table-toolbar"
import { PageHeader } from "@/components/shell/page-header"
import { ViewTabs } from "@/components/shell/view-tabs"
import type { ListView } from "@/components/shell/view-tabs"
import { resolveColumnLayout, toSavedLayout } from "@/lib/column-layout"
import type { ColumnLayout } from "@/lib/column-layout"
import { formatDate, fromLocalDay, toLocalDay } from "@/lib/format"
import { insightFocusKey } from "@/lib/key-insights"
import type { InsightFocus } from "@/lib/key-insights"
import { trimMoney } from "@/lib/money"
import { errorMessage } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

import { CloneQuoteDialog } from "./clone-quote-dialog"
import { CreateQuoteDialog } from "./create-quote-dialog"
import { INITIAL_QUOTE_LIST_INPUT } from "./list-input"
import type { QuoteListInput } from "./list-input"
import { DeleteQuoteDialog } from "./quote-actions"
import { STATUS_SOLID } from "./quote-status-badge"
import {
  DEFAULT_HIDDEN_QUOTE_COLUMNS,
  FIXED_QUOTE_COLUMNS,
  QUOTE_ACTIONS_COLUMN,
  QUOTE_COLUMN_IDS,
  QUOTE_SELECT_COLUMN,
  quoteColumns,
  QuoteRowActionsContext,
  QuoteRowMenu,
} from "./quote-columns"
import type { QuoteListRow, QuoteRowActions } from "./quote-columns"

const STATUS_OPTIONS = QUOTE_STATUSES.map((status) => ({
  value: status,
  label: QUOTE_STATUS_LABELS[status],
}))
const OWNER_OPTIONS = [{ value: "mine", label: "My Quotes" }]

type Sort = NonNullable<QuoteListInput["sort"]>

const layoutFor = (saved: { order: string[]; hidden: string[] } | null) =>
  resolveColumnLayout(QUOTE_COLUMN_IDS, saved, {
    fixed: FIXED_QUOTE_COLUMNS,
    defaultHidden: DEFAULT_HIDDEN_QUOTE_COLUMNS,
  })

/**
 * The Quote list (niko-table, server-side): search, faceted filters
 * (status, Account, owner), created date range, sorting and paging all run
 * on the server (`quote.list`); columns the user shows, hides and reorders
 * are saved to their preferences. Valid Until dates in the past are
 * highlighted. Each row's menu (and right-click) opens, clones or deletes
 * it; the select column feeds bulk delete, which reports the Quotes it
 * skipped. Status tabs above the table (with each status's count under the
 * other filters) set the status filter. `focus` is the Dashboard card
 * chosen in the URL (`?insight=…` / `?status=…`) and `initialFilters` the
 * list input it resolves to (the page prefetches exactly that); another
 * card resets the filters to its input.
 */
export function QuotesList({
  focus = null,
  initialFilters = INITIAL_QUOTE_LIST_INPUT,
}: {
  focus?: InsightFocus | null
  initialFilters?: QuoteListInput
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const router = useRouter()

  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search.trim())
  const [filters, setFilters] = useState<QuoteListInput>(initialFilters)
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

  // Selection is per page: any filter, sort or page change clears it.
  const [selection, setSelection] = useState<RowSelectionState>({})
  // A card click changes the URL: apply that card's filters.
  const focusKey = insightFocusKey(focus)
  const [appliedFocus, setAppliedFocus] = useState(focusKey)
  if (appliedFocus !== focusKey) {
    setAppliedFocus(focusKey)
    setFilters(initialFilters)
    setSelection({})
    setSearch("")
  }
  const setFilter = (changes: Partial<QuoteListInput>) => {
    setSelection({})
    setFilters((f) => ({ ...f, ...changes, page: changes.page ?? 1 }))
  }

  const [cloning, setCloning] = useState<QuoteListRow | null>(null)
  const [deleting, setDeleting] = useState<QuoteListRow | null>(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const rowActions: QuoteRowActions = {
    onClone: setCloning,
    onDelete: setDeleting,
  }

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
    // Re-resolve so fixed columns stay first whatever the menu did.
    const resolved = layoutFor(toSavedLayout(next, FIXED_QUOTE_COLUMNS))
    setLayout(resolved)
    saveLayout.mutate(toSavedLayout(resolved, FIXED_QUOTE_COLUMNS))
  }
  const movableOrder = layout.order.filter(
    (id) => !FIXED_QUOTE_COLUMNS.includes(id as never)
  )

  const sort: Sort = filters.sort ?? INITIAL_QUOTE_LIST_INPUT.sort
  const sorting: SortingState = useMemo(
    () => [{ id: sort.by, desc: sort.direction === "desc" }],
    [sort.by, sort.direction]
  )
  const onSortingChange = (next: SortingState) => {
    const [first] = next
    // Clearing the sort goes back to the default order (newest first).
    setFilter({
      sort: first
        ? { by: first.id as Sort["by"], direction: first.desc ? "desc" : "asc" }
        : INITIAL_QUOTE_LIST_INPUT.sort,
    })
  }

  // The faceted and date filters are column filters on the table; they
  // round-trip through the query input, which stays the source of truth.
  const statuses = filters.statuses ?? []
  const columnFilters: ColumnFiltersState = useMemo(
    () => [
      ...toColumnFilters({
        status: filters.statuses,
        account: filters.accountId,
        owner: filters.owner === "mine" ? "mine" : undefined,
      }),
      ...(filters.createdFrom || filters.createdTo
        ? [
            {
              id: "createdAt",
              value: [
                fromLocalDay(filters.createdFrom),
                fromLocalDay(filters.createdTo),
              ],
            },
          ]
        : []),
    ],
    [
      filters.statuses,
      filters.accountId,
      filters.owner,
      filters.createdFrom,
      filters.createdTo,
    ]
  )
  const onColumnFiltersChange = (next: ColumnFiltersState) => {
    const nextStatuses = facetValues(next, "status") as QuoteStatus[]
    const created = next.find((f) => f.id === "createdAt")?.value as
      | [number | undefined, number | undefined]
      | undefined
    setFilter({
      statuses: nextStatuses.length > 0 ? nextStatuses : undefined,
      accountId: facetValues(next, "account")[0],
      owner: facetValues(next, "owner")[0] === "mine" ? "mine" : "all",
      createdFrom: toLocalDay(created?.[0]),
      createdTo: toLocalDay(created?.[1]),
    })
  }

  const filtered =
    Boolean(deferredSearch) ||
    statuses.length > 0 ||
    Boolean(filters.accountId) ||
    Boolean(filters.createdFrom) ||
    Boolean(filters.createdTo) ||
    Boolean(filters.validUntilFrom) ||
    Boolean(filters.validUntilTo) ||
    filters.marginBelow !== undefined ||
    filters.owner === "mine"
  const clearFilters = () => {
    setSearch("")
    setSelection({})
    setFilters({ ...INITIAL_QUOTE_LIST_INPUT, sort })
    if (focus) router.push("/quotes", { scroll: false })
  }

  const rows = list.data?.rows ?? []
  const listTotal = list.data?.total ?? 0
  const counts = list.data?.statusCounts
  const statusViews: ListView<QuoteStatus | "all">[] = [
    {
      value: "all",
      label: "All",
      count: counts
        ? QUOTE_STATUSES.reduce((n, status) => n + counts[status], 0)
        : undefined,
    },
    ...QUOTE_STATUSES.map((status) => ({
      value: status,
      label: QUOTE_STATUS_LABELS[status],
      count: counts?.[status],
      dot: STATUS_SOLID[status],
    })),
  ]
  const selectedRows = rows.filter((row) => selection[row.id])

  const deleteMany = useMutation(
    trpc.quote.deleteMany.mutationOptions({
      onSuccess: async ({ deleted, skipped }) => {
        setBulkDeleting(false)
        setSelection({})
        if (deleted.length > 0) {
          toast.success(
            deleted.length === 1
              ? `Quote “${deleted[0]!.name}” deleted.`
              : `${deleted.length} Quotes deleted.`
          )
        }
        if (skipped.length > 0) {
          toast.warning(
            skipped.length === 1
              ? "1 Quote wasn't deleted"
              : `${skipped.length} Quotes weren't deleted`,
            {
              description: (
                <ul className="flex flex-col gap-0.5">
                  {skipped.map((s) => (
                    <li key={s.id}>
                      <span className="font-medium">{s.name}</span>: {s.reason}
                    </li>
                  ))}
                </ul>
              ),
              duration: 10_000,
            }
          )
        }
        await queryClient.invalidateQueries(trpc.quote.list.pathFilter())
        await queryClient.invalidateQueries(trpc.quote.insights.pathFilter())
        await queryClient.invalidateQueries(trpc.dashboard.pathFilter())
        await queryClient.invalidateQueries(
          trpc.quote.filterOptions.pathFilter()
        )
      },
      onError: (error) => toast.error(errorMessage(error)),
    })
  )

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

      <ViewTabs
        label="Quote status"
        views={statusViews}
        value={
          statuses.length === 0
            ? "all"
            : statuses.length === 1
              ? statuses[0]!
              : null
        }
        onValueChange={(view) =>
          setFilter({ statuses: view === "all" ? undefined : [view] })
        }
        summary={
          <>
            {focus?.kind === "insight" && (
              <span className="mr-1.5 font-medium text-foreground">
                {INSIGHT_LABELS[focus.key]} ·
              </span>
            )}
            <span className="tabular-nums">{listTotal}</span>{" "}
            {listTotal === 1 ? "Quote" : "Quotes"}
            {filtered ? " match" : ""}
          </>
        }
      />

      <QuoteRowActionsContext value={rowActions}>
        <ServerTableRoot
          columns={quoteColumns}
          data={list.data?.rows}
          isLoading={list.isPending}
          page={filters.page ?? 1}
          pageSize={filters.pageSize ?? INITIAL_QUOTE_LIST_INPUT.pageSize}
          total={list.data?.total ?? 0}
          onPageChange={({ page, pageSize }) => setFilter({ page, pageSize })}
          sorting={sorting}
          onSortingChange={onSortingChange}
          columnFilters={columnFilters}
          onColumnFiltersChange={onColumnFiltersChange}
          globalFilter={search}
          onGlobalFilterChange={(value) => {
            setSearch(value)
            setFilter({})
          }}
          rowSelection={selection}
          onRowSelectionChange={setSelection}
          columnVisibility={{
            ...layout.visibility,
            [QUOTE_SELECT_COLUMN]: true,
            [QUOTE_ACTIONS_COLUMN]: true,
          }}
          onColumnVisibilityChange={(visibility) =>
            changeLayout({ ...layout, visibility })
          }
          columnOrder={[
            QUOTE_SELECT_COLUMN,
            ...layout.order,
            QUOTE_ACTIONS_COLUMN,
          ]}
        >
          <DataTableToolbarSection className="px-0">
            <SearchFilter
              aria-label="Search Quotes"
              placeholder="Search name, description, Account"
              className="w-full flex-none sm:w-64"
            />
            <FacetedFilter
              accessorKey="status"
              options={STATUS_OPTIONS}
              multiple
              showCounts={false}
              limitToFilteredRows={false}
            />
            <FacetedFilter
              accessorKey="account"
              options={(options.data?.accounts ?? []).map((a) => ({
                value: a.id,
                label: a.name,
              }))}
              showCounts={false}
              limitToFilteredRows={false}
            />
            <FacetedFilter
              accessorKey="owner"
              options={OWNER_OPTIONS}
              showCounts={false}
              limitToFilteredRows={false}
            />
            <DateRangeFilter accessorKey="createdAt" />
            {(filters.validUntilFrom || filters.validUntilTo) && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setFilter({
                    validUntilFrom: undefined,
                    validUntilTo: undefined,
                  })
                }
              >
                Valid Until{" "}
                {filters.validUntilFrom
                  ? formatDate(filters.validUntilFrom)
                  : "…"}
                {" – "}
                {filters.validUntilTo ? formatDate(filters.validUntilTo) : "…"}
                <XIcon data-icon="inline-end" />
              </Button>
            )}
            {filters.marginBelow !== undefined && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setFilter({ marginBelow: undefined })}
              >
                Margin below {trimMoney(String(filters.marginBelow))} %
                <XIcon data-icon="inline-end" />
              </Button>
            )}
            {filtered && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <XIcon data-icon="inline-start" />
                Clear
              </Button>
            )}
            <ColumnsDndMenu
              columnOrder={movableOrder}
              onColumnOrderChange={(order) =>
                changeLayout({
                  ...layout,
                  order: [...FIXED_QUOTE_COLUMNS, ...order],
                })
              }
              onReset={() => changeLayout(layoutFor(null))}
            />
          </DataTableToolbarSection>

          <DataTableSelectionBar
            selectedCount={selectedRows.length}
            onClear={() => setSelection({})}
          >
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setBulkDeleting(true)}
            >
              <Trash2Icon data-icon="inline-start" />
              Delete
            </Button>
          </DataTableSelectionBar>

          <ListTable
            filtered={filtered}
            rowMenu={QuoteRowMenu}
            skeletonRows={8}
            empty={{
              icon: <FileTextIcon />,
              title: "No Quotes yet",
              description: "Create a Quote for one of your Accounts.",
              filteredTitle: "No Quotes match",
              filteredDescription: "Try another search or clear the filters.",
              action: (
                <Button onClick={() => setCreating(true)}>
                  <PlusIcon data-icon="inline-start" />
                  New Quote
                </Button>
              ),
              filteredAction: (
                <Button variant="outline" onClick={clearFilters}>
                  <XIcon data-icon="inline-start" />
                  Clear filters
                </Button>
              ),
            }}
          />
          <ServerPagination
            total={list.data?.total ?? 0}
            isFetching={list.isFetching}
          />
        </ServerTableRoot>
      </QuoteRowActionsContext>

      <CreateQuoteDialog open={creating} onOpenChange={setCreating} />
      {cloning && (
        <CloneQuoteDialog
          open
          onOpenChange={(open) => !open && setCloning(null)}
          source={cloning}
        />
      )}
      {deleting && (
        <DeleteQuoteDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          quote={deleting}
          onDeleted={() => setSelection({})}
        />
      )}
      <ConfirmDialog
        open={bulkDeleting}
        onOpenChange={setBulkDeleting}
        title={
          selectedRows.length === 1
            ? "Delete 1 Quote?"
            : `Delete ${selectedRows.length} Quotes?`
        }
        description="Each Quote you may delete is removed permanently with everything on it. Quotes you can't delete (not yours, or in a status that can't be deleted) are skipped and listed afterwards."
        confirmLabel="Delete"
        pending={deleteMany.isPending}
        onConfirm={() =>
          deleteMany.mutate({ ids: selectedRows.map((row) => row.id) })
        }
      />
    </>
  )
}
