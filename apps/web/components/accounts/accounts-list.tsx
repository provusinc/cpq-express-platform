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
import { FacetedFilter, SearchFilter } from "@/components/shell/table-toolbar"
import { PageHeader } from "@/components/shell/page-header"
import { errorMessage } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

import { AccountDialog } from "./account-dialog"
import { INITIAL_ACCOUNT_LIST_INPUT } from "./list-input"
import type { AccountListInput } from "./list-input"

type AccountRow = RouterOutputs["account"]["list"]["rows"][number]

const STATUS_OPTIONS = [
  { value: "archived", label: "Archived" },
  { value: "all", label: "Active and archived" },
]

interface AccountRowActions {
  onArchive: (account: AccountRow) => void
  onUnarchive: (account: AccountRow) => void
  onDelete: (account: AccountRow) => void
}
const AccountRowActionsContext = createContext<AccountRowActions | null>(null)

/** An Account's actions (its "…" menu and its right-click menu). */
function AccountRowMenu() {
  const actions = useContext(AccountRowActionsContext)!
  const account = useDataTableRow<AccountRow>()
  return (
    <>
      <RowMenuItem render={<Link href={`/accounts/${account.id}`} />}>
        <ExternalLinkIcon />
        Open
      </RowMenuItem>
      {account.archived ? (
        <RowMenuItem onClick={() => actions.onUnarchive(account)}>
          <ArchiveRestoreIcon />
          Unarchive
        </RowMenuItem>
      ) : (
        <RowMenuItem onClick={() => actions.onArchive(account)}>
          <ArchiveIcon />
          Archive
        </RowMenuItem>
      )}
      <RowMenuSeparator />
      <RowMenuItem
        variant="destructive"
        onClick={() => actions.onDelete(account)}
      >
        <Trash2Icon />
        Delete
      </RowMenuItem>
    </>
  )
}

const columns: DataTableColumns<AccountRow> = [
  selectColumn<AccountRow>({
    allLabel: "Select all on this page",
    rowLabel: (account) => `Select ${account.name}`,
  }),
  {
    id: "name",
    accessorKey: "name",
    header: ColumnTitle,
    meta: { label: "Name" },
    cell: ({ row }) => (
      <span className="font-medium">
        <Link href={`/accounts/${row.original.id}`} className="hover:underline">
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
  {
    id: "type",
    accessorKey: "type",
    header: ColumnTitle,
    meta: { label: "Type" },
  },
  {
    id: "industry",
    accessorKey: "industry",
    header: ColumnTitle,
    meta: { label: "Industry" },
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
  // Filter-only column (never shown): active / archived / all.
  {
    id: "archived",
    accessorKey: "archived",
    meta: { label: "Archived" },
    enableHiding: false,
  },
  actionsColumn<AccountRow>({
    label: (account) => `Actions for ${account.name}`,
    Menu: AccountRowMenu,
  }),
]

const COLUMN_VISIBILITY = { archived: false }

/** The Accounts page: search, filters, paging, create and bulk delete. */
export function AccountsList() {
  const trpc = useTRPC()
  const router = useRouter()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search.trim())
  const [filters, setFilters] = useState<AccountListInput>(
    INITIAL_ACCOUNT_LIST_INPUT
  )
  const input: AccountListInput = {
    ...filters,
    ...(deferredSearch ? { search: deferredSearch } : {}),
  }
  const list = useQuery({
    ...trpc.account.list.queryOptions(input),
    placeholderData: keepPreviousData,
  })
  const options = useQuery(trpc.account.filterOptions.queryOptions())

  const [selection, setSelection] = useState<RowSelectionState>({})
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<{
    ids: string[]
    label: string
  } | null>(null)

  const setFilter = (changes: Partial<AccountListInput>) => {
    setFilters((f) => ({ ...f, ...changes, page: changes.page ?? 1 }))
    setSelection({})
  }

  const invalidate = () =>
    queryClient.invalidateQueries(trpc.account.pathFilter())
  const archive = useMutation(
    trpc.account.archive.mutationOptions({
      onSuccess: async (a) => {
        toast.success(`“${a.name}” archived.`)
        await invalidate()
      },
      onError: (e) => toast.error(errorMessage(e)),
    })
  )
  const unarchive = useMutation(
    trpc.account.unarchive.mutationOptions({
      onSuccess: async (a) => {
        toast.success(`“${a.name}” restored.`)
        await invalidate()
      },
      onError: (e) => toast.error(errorMessage(e)),
    })
  )
  const deleteMany = useMutation(
    trpc.account.deleteMany.mutationOptions({
      onSuccess: async ({ ids }) => {
        toast.success(
          ids.length === 1
            ? "Account deleted."
            : `${ids.length} Accounts deleted.`
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
  const rowActions: AccountRowActions = {
    onArchive: (a) => archive.mutate({ id: a.id }),
    onUnarchive: (a) => unarchive.mutate({ id: a.id }),
    onDelete: (a) => setDeleting({ ids: [a.id], label: `“${a.name}”` }),
  }

  const rows = list.data?.rows ?? []
  const selectedIds = rows.filter((r) => selection[r.id]).map((r) => r.id)

  const columnFilters = toColumnFilters({
    type: filters.type,
    industry: filters.industry,
    archived: filters.status === "active" ? undefined : filters.status,
  })
  const onColumnFiltersChange = (next: ColumnFiltersState) =>
    setFilter({
      type: facetValues(next, "type")[0],
      industry: facetValues(next, "industry")[0],
      status: (facetValues(next, "archived")[0] ??
        "active") as AccountListInput["status"],
    })

  const filtered =
    Boolean(deferredSearch) ||
    Boolean(filters.type) ||
    Boolean(filters.industry) ||
    filters.status !== "active"

  return (
    <>
      <PageHeader
        title="Accounts"
        description="The companies you quote, and their Contacts."
      >
        <Button onClick={() => setCreating(true)}>
          <PlusIcon data-icon="inline-start" />
          New Account
        </Button>
      </PageHeader>

      <AccountRowActionsContext value={rowActions}>
        <ServerTableRoot
          columns={columns}
          data={list.data?.rows}
          isLoading={list.isPending}
          page={filters.page ?? 1}
          pageSize={filters.pageSize ?? INITIAL_ACCOUNT_LIST_INPUT.pageSize}
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
          columnVisibility={COLUMN_VISIBILITY}
        >
          <DataTableToolbarSection className="px-0">
            <SearchFilter
              aria-label="Search Accounts"
              placeholder="Search name, industry, website"
              className="w-full flex-none sm:w-64"
            />
            <FacetedFilter
              accessorKey="type"
              options={(options.data?.types ?? []).map((t) => ({
                value: t,
                label: t,
              }))}
              showCounts={false}
              limitToFilteredRows={false}
            />
            <FacetedFilter
              accessorKey="industry"
              options={(options.data?.industries ?? []).map((i) => ({
                value: i,
                label: i,
              }))}
              showCounts={false}
              limitToFilteredRows={false}
            />
            <FacetedFilter
              accessorKey="archived"
              options={STATUS_OPTIONS}
              showCounts={false}
              limitToFilteredRows={false}
            />
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
                      ? "the selected Account"
                      : `${selectedIds.length} Accounts`,
                })
              }
            >
              <Trash2Icon data-icon="inline-start" />
              Delete {selectedIds.length}
            </Button>
          </DataTableSelectionBar>
          <ListTable
            filtered={filtered}
            rowMenu={AccountRowMenu}
            empty={{
              icon: <Building2Icon />,
              title: "No Accounts yet",
              description: "Create the first company you quote.",
              filteredTitle: "No Accounts match",
              filteredDescription: "Try another search or clear the filters.",
            }}
          />
          <ServerPagination
            total={list.data?.total ?? 0}
            isFetching={list.isFetching}
          />
        </ServerTableRoot>
      </AccountRowActionsContext>

      <AccountDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(a) => router.push(`/accounts/${a.id}`)}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.label ?? ""}?`}
        description="Their Contacts are deleted too. An Account used by Quotes can't be deleted; archive it instead."
        pending={deleteMany.isPending}
        onConfirm={() => deleting && deleteMany.mutate({ ids: deleting.ids })}
      />
    </>
  )
}
