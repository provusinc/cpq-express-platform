"use client"

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { ColumnFiltersState } from "@tanstack/react-table"
import { PlusIcon, UserCogIcon } from "lucide-react"
import { createContext, useContext, useDeferredValue, useState } from "react"
import { toast } from "sonner"

import type { RouterOutputs } from "@workspace/api"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { DataTableFacetedFilter } from "@workspace/ui/components/niko-table/components/data-table-faceted-filter"
import { DataTableSearchFilter } from "@workspace/ui/components/niko-table/components/data-table-search-filter"
import { DataTableToolbarSection } from "@workspace/ui/components/niko-table/components/data-table-toolbar-section"
import type { DataTableColumns } from "@workspace/ui/components/niko-table/types"

import { STATUS_OPTIONS } from "@/components/catalog/labels"
import { PriceRangeFilter } from "@/components/catalog/price-range-filter"
import {
  ManagedRowActionsContext,
  ManagedRowMenu,
} from "@/components/catalog/row-menu"
import type { ManagedRowActions } from "@/components/catalog/row-menu"
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

import { INITIAL_RESOURCE_ROLE_LIST_INPUT } from "./list-input"
import type { ResourceRoleListInput } from "./list-input"
import { ResourceRoleDialog } from "./resource-role-dialog"

type ResourceRole = RouterOutputs["resourceRole"]["list"]["rows"][number]

/** The currency the rate cells format in (the Organization's). */
const CurrencyContext = createContext("USD")

function RateCell({ value }: { value: string }) {
  const currency = useContext(CurrencyContext)
  return (
    <div className="text-right tabular-nums">
      {formatMoney(value, currency)}
    </div>
  )
}

const dataColumns: DataTableColumns<ResourceRole> = [
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
    id: "billRate",
    accessorKey: "billRate",
    header: ColumnTitle,
    meta: { label: "Bill rate / h", align: "end" },
    cell: ({ row }) => <RateCell value={row.original.billRate} />,
  },
  {
    id: "costRate",
    accessorKey: "costRate",
    header: ColumnTitle,
    meta: { label: "Cost rate / h", align: "end" },
    cell: ({ row }) => <RateCell value={row.original.costRate} />,
  },
  {
    id: "location",
    header: ColumnTitle,
    meta: { label: "Location" },
    accessorFn: (r) =>
      [r.locationCity, r.locationState, r.locationCountry]
        .filter(Boolean)
        .join(", "),
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
  // Filter-only columns (never shown).
  {
    id: "locationCountry",
    accessorKey: "locationCountry",
    meta: { label: "Country" },
    enableHiding: false,
  },
  {
    id: "locationState",
    accessorKey: "locationState",
    meta: { label: "State" },
    enableHiding: false,
  },
  {
    id: "locationCity",
    accessorKey: "locationCity",
    meta: { label: "City" },
    enableHiding: false,
  },
]
const readColumns = dataColumns
const manageColumns: DataTableColumns<ResourceRole> = [
  ...dataColumns,
  actionsColumn<ResourceRole>({
    label: (role) => `Actions for ${role.name}`,
    Menu: ManagedRowMenu,
  }),
]
/** Filter-only columns never show; the Description starts hidden. */
const INITIAL_VISIBILITY = {
  locationCountry: false,
  locationState: false,
  locationCity: false,
  description: false,
}

const distinct = (values: (string | null)[]) =>
  [...new Set(values.filter((v): v is string => Boolean(v)))]
    .sort()
    .map((v) => ({ value: v, label: v }))

/** The Resource Roles page: filters, paging and, for Admins, management. */
export function ResourceRolesList({
  canManage,
  currencyCode,
  toolbar,
}: {
  canManage: boolean
  currencyCode: string
  toolbar?: React.ReactNode
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const label = useLabels().resource_role

  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search.trim())
  const [filters, setFilters] = useState<ResourceRoleListInput>(
    INITIAL_RESOURCE_ROLE_LIST_INPUT
  )
  const input: ResourceRoleListInput = {
    ...filters,
    ...(deferredSearch ? { search: deferredSearch } : {}),
  }
  const list = useQuery({
    ...trpc.resourceRole.list.queryOptions(input),
    placeholderData: keepPreviousData,
  })
  const locations = useQuery(trpc.resourceRole.locations.queryOptions())
  const setFilter = (changes: Partial<ResourceRoleListInput>) =>
    setFilters((f) => ({ ...f, ...changes, page: changes.page ?? 1 }))

  // Narrow the state and city choices to the chosen country / state.
  const all = locations.data ?? []
  const inCountry = all.filter(
    (l) => !filters.country || l.country === filters.country
  )
  const inState = inCountry.filter(
    (l) => !filters.state || l.state === filters.state
  )

  const [dialog, setDialog] = useState<{ role: ResourceRole | null } | null>(
    null
  )
  const [deleting, setDeleting] = useState<ResourceRole | null>(null)
  const invalidate = () =>
    queryClient.invalidateQueries(trpc.resourceRole.pathFilter())
  const onError = (e: unknown) => toast.error(errorMessage(e))
  const deactivate = useMutation(
    trpc.resourceRole.deactivate.mutationOptions({
      onSuccess: async (r) => {
        toast.success(`“${r.name}” deactivated.`)
        await invalidate()
      },
      onError,
    })
  )
  const reactivate = useMutation(
    trpc.resourceRole.reactivate.mutationOptions({
      onSuccess: async (r) => {
        toast.success(`“${r.name}” reactivated.`)
        await invalidate()
      },
      onError,
    })
  )
  const remove = useMutation(
    trpc.resourceRole.delete.mutationOptions({
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
    onEdit: (row) => setDialog({ role: row as ResourceRole }),
    onDeactivate: (row) => deactivate.mutate({ id: row.id }),
    onReactivate: (row) => reactivate.mutate({ id: row.id }),
    onDelete: (row) => setDeleting(row as ResourceRole),
  }

  const columnFilters = toColumnFilters({
    active: filters.status === "all" ? undefined : filters.status,
    locationCountry: filters.country,
    locationState: filters.state,
    locationCity: filters.city,
  })
  const onColumnFiltersChange = (next: ColumnFiltersState) => {
    const country = facetValues(next, "locationCountry")[0]
    // A broader place resets the narrower ones.
    const state =
      country === filters.country
        ? facetValues(next, "locationState")[0]
        : undefined
    const city =
      state === filters.state ? facetValues(next, "locationCity")[0] : undefined
    setFilter({
      status: (facetValues(next, "active")[0] ??
        "all") as ResourceRoleListInput["status"],
      country,
      state,
      city,
    })
  }

  const filtered =
    Boolean(deferredSearch) ||
    filters.status !== "all" ||
    Boolean(filters.minRate || filters.maxRate) ||
    Boolean(filters.country || filters.state || filters.city)

  return (
    <>
      <PageHeader
        title={label.plural}
        description="Labour sold by the hour, with bill and cost rates."
      >
        {canManage && toolbar}
        {canManage && (
          <Button onClick={() => setDialog({ role: null })}>
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
              <DataTableFacetedFilter
                accessorKey="active"
                options={[...STATUS_OPTIONS]}
                showCounts={false}
                limitToFilteredRows={false}
              />
              <DataTableFacetedFilter
                accessorKey="locationCountry"
                title="Country"
                options={distinct(all.map((l) => l.country))}
                showCounts={false}
                limitToFilteredRows={false}
              />
              <DataTableFacetedFilter
                accessorKey="locationState"
                title="State"
                options={distinct(inCountry.map((l) => l.state))}
                showCounts={false}
                limitToFilteredRows={false}
              />
              <DataTableFacetedFilter
                accessorKey="locationCity"
                title="City"
                options={distinct(inState.map((l) => l.city))}
                showCounts={false}
                limitToFilteredRows={false}
              />
              <PriceRangeFilter
                label="rate"
                onChange={({ min, max }) =>
                  setFilter({ minRate: min, maxRate: max })
                }
              />
              <ColumnsMenu />
            </DataTableToolbarSection>
            <ListTable
              filtered={filtered}
              rowMenu={canManage ? ManagedRowMenu : undefined}
              empty={{
                icon: <UserCogIcon />,
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
          <ResourceRoleDialog
            open={dialog !== null}
            onOpenChange={(open) => !open && setDialog(null)}
            role={dialog?.role}
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
