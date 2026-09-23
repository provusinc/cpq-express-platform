"use client"

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { ColumnFiltersState } from "@tanstack/react-table"
import { PackageIcon, PlusIcon } from "lucide-react"
import { createContext, useContext, useDeferredValue, useState } from "react"
import { toast } from "sonner"

import type { RouterOutputs } from "@workspace/api"
import type { CatalogItemKind } from "@workspace/domain/enums"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { DataTableFacetedFilter } from "@workspace/ui/components/niko-table/components/data-table-faceted-filter"
import { DataTableSearchFilter } from "@workspace/ui/components/niko-table/components/data-table-search-filter"
import { DataTableToolbarSection } from "@workspace/ui/components/niko-table/components/data-table-toolbar-section"
import type { DataTableColumns } from "@workspace/ui/components/niko-table/types"

import { ConfirmDialog } from "@/components/shell/confirm-dialog"
import {
  actionsColumn,
  ColumnsMenu,
  ColumnTitle,
  facetValues,
  ListTable,
  ServerPagination,
  ServerTableRoot,
  toColumnFilters,
} from "@/components/shell/data-table"
import { useLabels } from "@/components/shell/labels"
import { PageHeader } from "@/components/shell/page-header"
import { formatMoney } from "@/lib/money"
import { errorMessage } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

import { CatalogItemDialog } from "./catalog-item-dialog"
import { BILLING_UNIT_LABELS, STATUS_OPTIONS } from "./labels"
import { initialCatalogItemListInput } from "./list-input"
import type { CatalogItemListInput } from "./list-input"
import { PriceRangeFilter } from "./price-range-filter"
import { ManagedRowActionsContext, ManagedRowMenu } from "./row-menu"
import type { ManagedRowActions } from "./row-menu"

type CatalogItem = RouterOutputs["catalogItem"]["list"]["rows"][number]

/** The currency the money cells format in (the Organization's). */
const CurrencyContext = createContext("USD")

function MoneyCell({ value }: { value: string }) {
  const currency = useContext(CurrencyContext)
  return (
    <div className="text-right tabular-nums">
      {formatMoney(value, currency)}
    </div>
  )
}

const dataColumns: DataTableColumns<CatalogItem> = [
  {
    id: "name",
    accessorKey: "name",
    header: ColumnTitle,
    meta: { label: "Name" },
    enableHiding: false,
    // One line: the Description is its own (hidden by default) column and
    // the Name's tooltip.
    cell: ({ row }) => (
      <span
        className="block max-w-80 truncate font-medium"
        title={row.original.description ?? undefined}
      >
        {row.original.name}
      </span>
    ),
  },
  {
    id: "description",
    accessorKey: "description",
    header: ColumnTitle,
    meta: { label: "Description" },
    cell: ({ row }) => (
      <span className="block max-w-80 truncate text-muted-foreground">
        {row.original.description}
      </span>
    ),
  },
  {
    id: "price",
    accessorKey: "price",
    header: ColumnTitle,
    meta: { label: "Price", align: "end" },
    cell: ({ row }) => <MoneyCell value={row.original.price} />,
  },
  {
    id: "cost",
    accessorKey: "cost",
    header: ColumnTitle,
    meta: { label: "Cost", align: "end" },
    cell: ({ row }) => <MoneyCell value={row.original.cost} />,
  },
  {
    id: "billingUnit",
    accessorKey: "billingUnit",
    header: ColumnTitle,
    meta: { label: "Billing unit" },
    cell: ({ row }) => BILLING_UNIT_LABELS[row.original.billingUnit],
  },
  {
    id: "tags",
    accessorKey: "tags",
    header: ColumnTitle,
    meta: { label: "Tags" },
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        {row.original.tags.map((tag) => (
          <Badge key={tag} variant="outline">
            {tag}
          </Badge>
        ))}
      </div>
    ),
  },
  {
    id: "active",
    accessorKey: "active",
    header: ColumnTitle,
    meta: { label: "Status" },
    cell: ({ row }) =>
      row.original.active ? (
        <Badge variant="secondary">Active</Badge>
      ) : (
        <Badge variant="outline">Inactive</Badge>
      ),
  },
]
/** The Description starts hidden (the Columns menu shows it). */
const INITIAL_VISIBILITY = { description: false }
const readColumns = dataColumns
const manageColumns: DataTableColumns<CatalogItem> = [
  ...dataColumns,
  actionsColumn<CatalogItem>({
    label: (item) => `Actions for ${item.name}`,
    Menu: ManagedRowMenu,
  }),
]
const BILLING_UNIT_OPTIONS = [
  { value: "each", label: "Each" },
  { value: "hour", label: "Hour" },
]

/**
 * The Products or Add-ons page: filters, paging and, for Admins, create,
 * edit, deactivate and delete. `toolbar` adds page actions (CSV import).
 */
export function CatalogItemsList({
  kind,
  canManage,
  currencyCode,
  toolbar,
}: {
  kind: CatalogItemKind
  canManage: boolean
  currencyCode: string
  toolbar?: React.ReactNode
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const label = useLabels()[kind]

  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search.trim())
  const [filters, setFilters] = useState<CatalogItemListInput>(() =>
    initialCatalogItemListInput(kind)
  )
  const input: CatalogItemListInput = {
    ...filters,
    ...(deferredSearch ? { search: deferredSearch } : {}),
  }
  const list = useQuery({
    ...trpc.catalogItem.list.queryOptions(input),
    placeholderData: keepPreviousData,
  })
  const tags = useQuery(trpc.catalogItem.tags.queryOptions({ kind }))

  const setFilter = (changes: Partial<CatalogItemListInput>) =>
    setFilters((f) => ({ ...f, ...changes, page: changes.page ?? 1 }))

  const [dialog, setDialog] = useState<{ item: CatalogItem | null } | null>(
    null
  )
  const [deleting, setDeleting] = useState<CatalogItem | null>(null)

  const invalidate = () =>
    queryClient.invalidateQueries(trpc.catalogItem.pathFilter())
  const onError = (e: unknown) => toast.error(errorMessage(e))
  const deactivate = useMutation(
    trpc.catalogItem.deactivate.mutationOptions({
      onSuccess: async (i) => {
        toast.success(`“${i.name}” deactivated.`)
        await invalidate()
      },
      onError,
    })
  )
  const reactivate = useMutation(
    trpc.catalogItem.reactivate.mutationOptions({
      onSuccess: async (i) => {
        toast.success(`“${i.name}” reactivated.`)
        await invalidate()
      },
      onError,
    })
  )
  const remove = useMutation(
    trpc.catalogItem.delete.mutationOptions({
      onSuccess: async () => {
        toast.success(`${label.singular} deleted.`)
        setDeleting(null)
        await invalidate()
      },
      onError: (e) => {
        setDeleting(null)
        onError(e)
      },
    })
  )

  const [visibility, setVisibility] =
    useState<Record<string, boolean>>(INITIAL_VISIBILITY)
  const rowActions: ManagedRowActions = {
    onEdit: (row) => setDialog({ item: row as CatalogItem }),
    onDeactivate: (row) => deactivate.mutate({ id: row.id }),
    onReactivate: (row) => reactivate.mutate({ id: row.id }),
    onDelete: (row) => setDeleting(row as CatalogItem),
  }

  const columnFilters = toColumnFilters({
    billingUnit: filters.billingUnit,
    active: filters.status === "all" ? undefined : filters.status,
    tags: filters.tags,
  })
  const onColumnFiltersChange = (next: ColumnFiltersState) => {
    const nextTags = facetValues(next, "tags")
    setFilter({
      billingUnit: facetValues(next, "billingUnit")[0] as
        | CatalogItemListInput["billingUnit"]
        | undefined,
      status: (facetValues(next, "active")[0] ??
        "all") as CatalogItemListInput["status"],
      tags: nextTags.length > 0 ? nextTags : undefined,
    })
  }

  const filtered =
    Boolean(deferredSearch) ||
    Boolean(filters.billingUnit) ||
    filters.status !== "all" ||
    Boolean(filters.minPrice) ||
    Boolean(filters.maxPrice) ||
    Boolean(filters.tags?.length)

  return (
    <>
      <PageHeader
        title={label.plural}
        description={
          kind === "product"
            ? "Catalog Items sold per unit (billed Each)."
            : "Supplementary Catalog Items, billed Each or by the Hour."
        }
      >
        {canManage && toolbar}
        {canManage && (
          <Button onClick={() => setDialog({ item: null })}>
            <PlusIcon data-icon="inline-start" />
            New {label.singular}
          </Button>
        )}
      </PageHeader>

      <CurrencyContext value={currencyCode}>
        <ManagedRowActionsContext value={rowActions}>
          <ServerTableRoot
            columns={canManage ? manageColumns : readColumns}
            data={list.data?.rows}
            isLoading={list.isPending}
            page={filters.page ?? 1}
            pageSize={filters.pageSize ?? 25}
            total={list.data?.total ?? 0}
            onPageChange={(paging) => setFilter(paging)}
            columnFilters={columnFilters}
            onColumnFiltersChange={onColumnFiltersChange}
            globalFilter={search}
            onGlobalFilterChange={(value) => {
              setSearch(value)
              setFilter({})
            }}
            columnVisibility={visibility}
            onColumnVisibilityChange={setVisibility}
          >
            <DataTableToolbarSection className="px-0">
              <DataTableSearchFilter
                aria-label={`Search ${label.plural}`}
                placeholder="Search name or description"
                className="w-full flex-none sm:w-64"
              />
              {kind === "add_on" && (
                <DataTableFacetedFilter
                  accessorKey="billingUnit"
                  options={BILLING_UNIT_OPTIONS}
                  showCounts={false}
                  limitToFilteredRows={false}
                />
              )}
              <DataTableFacetedFilter
                accessorKey="active"
                options={[...STATUS_OPTIONS]}
                showCounts={false}
                limitToFilteredRows={false}
              />
              <DataTableFacetedFilter
                accessorKey="tags"
                options={(tags.data ?? []).map((t) => ({ value: t, label: t }))}
                multiple
                showCounts={false}
                limitToFilteredRows={false}
              />
              <PriceRangeFilter
                label="price"
                onChange={({ min, max }) =>
                  setFilter({ minPrice: min, maxPrice: max })
                }
              />
              <ColumnsMenu />
            </DataTableToolbarSection>
            <ListTable
              filtered={filtered}
              rowMenu={canManage ? ManagedRowMenu : undefined}
              empty={{
                icon: <PackageIcon />,
                title: `No ${label.plural} yet`,
                description: canManage
                  ? `Create your first ${label.singular} or import a CSV.`
                  : `An Admin adds ${label.plural} here.`,
                filteredTitle: `No ${label.plural} match`,
                filteredDescription: "Try another search or clear the filters.",
              }}
            />
            <ServerPagination
              total={list.data?.total ?? 0}
              isFetching={list.isFetching}
            />
          </ServerTableRoot>
        </ManagedRowActionsContext>
      </CurrencyContext>

      {canManage && (
        <>
          <CatalogItemDialog
            kind={kind}
            open={dialog !== null}
            onOpenChange={(open) => !open && setDialog(null)}
            item={dialog?.item}
          />
          <ConfirmDialog
            open={deleting !== null}
            onOpenChange={(open) => !open && setDeleting(null)}
            title={`Delete “${deleting?.name ?? ""}”?`}
            description={`Only ${label.plural} never used on a Quote can be deleted; deactivate it to stop it being added instead.`}
            pending={remove.isPending}
            onConfirm={() => deleting && remove.mutate({ id: deleting.id })}
          />
        </>
      )}
    </>
  )
}
