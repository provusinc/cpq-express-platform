"use client"

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type {
  ColumnFiltersState,
  RowSelectionState,
} from "@tanstack/react-table"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  Building2Icon,
  ExternalLinkIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createContext, useContext, useDeferredValue, useState } from "react"
import { toast } from "sonner"

import type { RouterOutputs } from "@workspace/api"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  RowMenuItem,
  RowMenuSeparator,
  useDataTableRow,
} from "@workspace/ui/components/niko-table/components/data-table-row-menu"
import { DataTableSelectionBar } from "@workspace/ui/components/niko-table/components/data-table-selection-bar"
import { DataTableToolbarSection } from "@workspace/ui/components/niko-table/components/data-table-toolbar-section"
import type { DataTableColumns } from "@workspace/ui/components/niko-table/types"

import { ConfirmDialog } from "@/components/shell/confirm-dialog"
import {
  actionsColumn,
  ColumnTitle,
  facetValues,
  ListTable,
  selectColumn,
  ServerPagination,
  ServerTableRoot,
  toColumnFilters,
} from "@/components/shell/data-table"
import {
  ColumnsMenu,
  FacetedFilter,
  SearchFilter,
} from "@/components/shell/table-toolbar"
import { PageHeader } from "@/components/shell/page-header"
import { ViewTabs } from "@/components/shell/view-tabs"
import { errorMessage } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

import { ClassificationName } from "./classification-name"
import { CustomerDialog } from "./customer-dialog"
import { INITIAL_CUSTOMER_LIST_INPUT } from "./list-input"
import type { CustomerListInput } from "./list-input"

type CustomerRow = RouterOutputs["customer"]["list"]["rows"][number]

/** The status tabs; Active is the default. */
const STATUS_VIEWS = [
  { value: "active", label: "Active", dot: "bg-success" },
  { value: "archived", label: "Archived", dot: "bg-neutral" },
  { value: "all", label: "All" },
] as const

interface CustomerRowActions {
  onArchive: (customer: CustomerRow) => void
  onUnarchive: (customer: CustomerRow) => void
  onDelete: (customer: CustomerRow) => void
}
const CustomerRowActionsContext = createContext<CustomerRowActions | null>(null)

/** A Customer's actions (its "…" menu and its right-click menu). */
function CustomerRowMenu() {
  const actions = useContext(CustomerRowActionsContext)!
  const customer = useDataTableRow<CustomerRow>()
  return (
    <>
      <RowMenuItem render={<Link href={`/customers/${customer.id}`} />}>
        <ExternalLinkIcon />
        Open
      </RowMenuItem>
      {customer.archived ? (
        <RowMenuItem onClick={() => actions.onUnarchive(customer)}>
          <ArchiveRestoreIcon />
          Unarchive
        </RowMenuItem>
      ) : (
        <RowMenuItem onClick={() => actions.onArchive(customer)}>
          <ArchiveIcon />
          Archive
        </RowMenuItem>
      )}
      <RowMenuSeparator />
      <RowMenuItem
        variant="destructive"
        onClick={() => actions.onDelete(customer)}
      >
        <Trash2Icon />
        Delete
      </RowMenuItem>
    </>
  )
}

const columns: DataTableColumns<CustomerRow> = [
  selectColumn<CustomerRow>({
    allLabel: "Select all on this page",
    rowLabel: (customer) => `Select ${customer.name}`,
  }),
  {
    id: "name",
    accessorKey: "name",
    header: ColumnTitle,
    meta: { label: "Name" },
    enableHiding: false,
    cell: ({ row }) => (
      <span className="font-medium">
        <Link
          href={`/customers/${row.original.id}`}
          className="hover:underline"
        >
          {row.original.name}
        </Link>
        {row.original.archived && (
          <Badge variant="secondary" className="ml-2">
            Archived
          </Badge>
        )}
      </span>
    ),
  },
  // Optional columns (the Columns menu), filtered by value id on the server.
  {
    id: "customerType",
    accessorFn: (c) => c.customerType?.id ?? "",
    header: ColumnTitle,
    meta: { label: "Type" },
    cell: ({ row }) => <ClassificationName value={row.original.customerType} />,
  },
  {
    id: "industry",
    accessorFn: (c) => c.industry?.id ?? "",
    header: ColumnTitle,
    meta: { label: "Industry" },
    cell: ({ row }) => <ClassificationName value={row.original.industry} />,
  },
  {
    id: "location",
    header: ColumnTitle,
    meta: { label: "Location" },
    accessorFn: (a) =>
      [a.billingCity, a.billingState, a.billingCountry]
        .filter(Boolean)
        .join(", "),
  },
  {
    id: "primaryContact",
    header: ColumnTitle,
    meta: { label: "Primary Contact" },
    accessorFn: (a) => a.primaryContact?.name ?? "",
    cell: ({ row }) =>
      row.original.primaryContact?.name ?? (
        <span className="text-muted-foreground">
          {row.original.contactCount === 0 ? "—" : "None set"}
        </span>
      ),
  },
  actionsColumn<CustomerRow>({
    label: (customer) => `Actions for ${customer.name}`,
    Menu: CustomerRowMenu,
  }),
]

/** The Customers page: search, filters, paging, create and bulk delete. */
export function CustomersList() {
  const trpc = useTRPC()
  const router = useRouter()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search.trim())
  const [filters, setFilters] = useState<CustomerListInput>(
    INITIAL_CUSTOMER_LIST_INPUT
  )
  const input: CustomerListInput = {
    ...filters,
    ...(deferredSearch ? { search: deferredSearch } : {}),
  }
  const list = useQuery({
    ...trpc.customer.list.queryOptions(input),
    placeholderData: keepPreviousData,
  })
  // The lists' values are the filters' static options (retired ones too:
  // Customers keep them).
  const classifications = useQuery(
    trpc.settings.customerClassifications.queryOptions()
  )
  const filterOptions = (kind: "customer_type" | "industry") =>
    (classifications.data ?? [])
      .filter((v) => v.kind === kind)
      .map((v) => ({
        value: v.id,
        label: v.retired ? `${v.name} (retired)` : v.name,
      }))
  const [visibility, setVisibility] = useState<Record<string, boolean>>({})

  const [selection, setSelection] = useState<RowSelectionState>({})
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<{
    ids: string[]
    label: string
  } | null>(null)

  const setFilter = (changes: Partial<CustomerListInput>) => {
    setFilters((f) => ({ ...f, ...changes, page: changes.page ?? 1 }))
    setSelection({})
  }

  const invalidate = () =>
    queryClient.invalidateQueries(trpc.customer.pathFilter())
  const archive = useMutation(
    trpc.customer.archive.mutationOptions({
      onSuccess: async (a) => {
        toast.success(`“${a.name}” archived.`)
        await invalidate()
      },
      onError: (e) => toast.error(errorMessage(e)),
    })
  )
  const unarchive = useMutation(
    trpc.customer.unarchive.mutationOptions({
      onSuccess: async (a) => {
        toast.success(`“${a.name}” restored.`)
        await invalidate()
      },
      onError: (e) => toast.error(errorMessage(e)),
    })
  )
  const deleteMany = useMutation(
    trpc.customer.deleteMany.mutationOptions({
      onSuccess: async ({ ids }) => {
        toast.success(
          ids.length === 1
            ? "Customer deleted."
            : `${ids.length} Customers deleted.`
        )
        setSelection({})
        setDeleting(null)
        await invalidate()
      },
      onError: (e) => {
        setDeleting(null)
        toast.error(errorMessage(e))
      },
    })
  )
  const rowActions: CustomerRowActions = {
    onArchive: (a) => archive.mutate({ id: a.id }),
    onUnarchive: (a) => unarchive.mutate({ id: a.id }),
    onDelete: (a) => setDeleting({ ids: [a.id], label: `“${a.name}”` }),
  }

  const rows = list.data?.rows ?? []
  const selectedIds = rows.filter((r) => selection[r.id]).map((r) => r.id)

  const columnFilters = toColumnFilters({
    customerType: filters.customerTypeIds,
    industry: filters.industryIds,
  })
  const onColumnFiltersChange = (next: ColumnFiltersState) => {
    const customerTypeIds = facetValues(next, "customerType")
    const industryIds = facetValues(next, "industry")
    setFilter({
      customerTypeIds: customerTypeIds.length ? customerTypeIds : undefined,
      industryIds: industryIds.length ? industryIds : undefined,
    })
  }

  const filtered =
    Boolean(deferredSearch) ||
    Boolean(filters.customerTypeIds?.length) ||
    Boolean(filters.industryIds?.length)
  const clearFilters = () => {
    setSearch("")
    setFilter({ customerTypeIds: undefined, industryIds: undefined })
  }

  return (
    <>
      <PageHeader
        title="Customers"
        description="The customers you quote, and their Contacts."
      >
        <Button onClick={() => setCreating(true)}>
          <PlusIcon data-icon="inline-start" />
          New Customer
        </Button>
      </PageHeader>

      <ViewTabs
        label="Customer status"
        views={STATUS_VIEWS.map((view) => ({
          ...view,
          count: list.data?.statusCounts[view.value],
        }))}
        value={filters.status ?? "active"}
        onValueChange={(status) => setFilter({ status })}
        summary={
          <>
            <span className="tabular-nums">{list.data?.total ?? 0}</span>{" "}
            {list.data?.total === 1 ? "Customer" : "Customers"}
            {filtered ? " match" : ""}
          </>
        }
      />

      <CustomerRowActionsContext value={rowActions}>
        <ServerTableRoot
          columns={columns}
          data={list.data?.rows}
          isLoading={list.isPending}
          page={filters.page ?? 1}
          pageSize={filters.pageSize ?? INITIAL_CUSTOMER_LIST_INPUT.pageSize}
          total={list.data?.total ?? 0}
          onPageChange={(paging) => setFilter(paging)}
          columnFilters={columnFilters}
          onColumnFiltersChange={onColumnFiltersChange}
          globalFilter={search}
          onGlobalFilterChange={(value) => {
            setSearch(value)
            setFilter({})
          }}
          rowSelection={selection}
          onRowSelectionChange={setSelection}
          columnVisibility={visibility}
          onColumnVisibilityChange={setVisibility}
        >
          <DataTableToolbarSection className="px-0">
            <SearchFilter
              aria-label="Search Customers"
              placeholder="Search name, industry, website"
              className="w-full flex-none sm:w-64"
            />
            <FacetedFilter
              accessorKey="customerType"
              options={filterOptions("customer_type")}
              showCounts={false}
              limitToFilteredRows={false}
            />
            <FacetedFilter
              accessorKey="industry"
              options={filterOptions("industry")}
              showCounts={false}
              limitToFilteredRows={false}
            />
            <ColumnsMenu />
          </DataTableToolbarSection>
          <DataTableSelectionBar
            selectedCount={selectedIds.length}
            onClear={() => setSelection({})}
          >
            <Button
              variant="destructive"
              size="sm"
              onClick={() =>
                setDeleting({
                  ids: selectedIds,
                  label:
                    selectedIds.length === 1
                      ? "the selected Customer"
                      : `${selectedIds.length} Customers`,
                })
              }
            >
              <Trash2Icon data-icon="inline-start" />
              Delete {selectedIds.length}
            </Button>
          </DataTableSelectionBar>
          <ListTable
            filtered={filtered}
            rowMenu={CustomerRowMenu}
            empty={{
              icon: <Building2Icon />,
              title:
                filters.status === "archived"
                  ? "No archived Customers"
                  : "No Customers yet",
              description:
                filters.status === "archived"
                  ? "Archive a Customer to hide it from new Quotes."
                  : "Create the first customer you quote.",
              filteredTitle: "No Customers match",
              filteredDescription: "Try another search or clear the filters.",
              action:
                filters.status === "archived" ? undefined : (
                  <Button onClick={() => setCreating(true)}>
                    <PlusIcon data-icon="inline-start" />
                    New Customer
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
      </CustomerRowActionsContext>

      <CustomerDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(a) => router.push(`/customers/${a.id}`)}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.label ?? ""}?`}
        description="Their Contacts are deleted too. A Customer used by Quotes can't be deleted; archive it instead."
        pending={deleteMany.isPending}
        onConfirm={() => deleting && deleteMany.mutate({ ids: deleting.ids })}
      />
    </>
  )
}
