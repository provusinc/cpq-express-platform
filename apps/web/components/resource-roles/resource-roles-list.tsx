"use client"

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  PowerIcon,
  PowerOffIcon,
  SearchIcon,
  Trash2Icon,
  UserCogIcon,
} from "lucide-react"
import { useDeferredValue, useState } from "react"
import { toast } from "sonner"

import type { RouterOutputs } from "@workspace/api"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
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

import { STATUS_OPTIONS } from "@/components/catalog/labels"
import { PriceRangeFilter } from "@/components/catalog/price-range-filter"
import { ConfirmDialog } from "@/components/shell/confirm-dialog"
import { FilterSelect } from "@/components/shell/filter-select"
import { ListPagination } from "@/components/shell/list-pagination"
import { PageHeader } from "@/components/shell/page-header"
import { formatMoney } from "@/lib/money"
import { errorMessage } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

import { INITIAL_RESOURCE_ROLE_LIST_INPUT } from "./list-input"
import type { ResourceRoleListInput } from "./list-input"
import { ResourceRoleDialog } from "./resource-role-dialog"

type ResourceRole = RouterOutputs["resourceRole"]["list"]["rows"][number]

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
        toast.success("Resource Role deleted.")
        setDeleting(null)
        await invalidate()
      },
      onError: (e) => {
        setDeleting(null)
        onError(e)
      },
    })
  )

  const rows = list.data?.rows ?? []
  const filtered =
    Boolean(deferredSearch) ||
    filters.status !== "all" ||
    Boolean(filters.minRate || filters.maxRate) ||
    Boolean(filters.country || filters.state || filters.city)

  return (
    <>
      <PageHeader
        title="Resource Roles"
        description="Labour sold by the hour, with bill and cost rates."
      >
        {canManage && toolbar}
        {canManage && (
          <Button onClick={() => setDialog({ role: null })}>
            <PlusIcon data-icon="inline-start" />
            New Resource Role
          </Button>
        )}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="w-full sm:w-64">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search Resource Roles"
            placeholder="Search name or description"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setFilter({})
            }}
          />
        </InputGroup>
        <FilterSelect
          label="Status"
          allLabel="Active and inactive"
          className="w-44"
          value={filters.status === "all" ? undefined : filters.status}
          options={STATUS_OPTIONS}
          onChange={(v) =>
            setFilter({
              status: (v ?? "all") as ResourceRoleListInput["status"],
            })
          }
        />
        <PriceRangeFilter
          label="rate"
          onChange={({ min, max }) => setFilter({ minRate: min, maxRate: max })}
        />
        <FilterSelect
          label="Country"
          allLabel="All countries"
          value={filters.country}
          options={distinct(all.map((l) => l.country))}
          onChange={(country) =>
            setFilter({ country, state: undefined, city: undefined })
          }
        />
        <FilterSelect
          label="State"
          allLabel="All states"
          value={filters.state}
          options={distinct(inCountry.map((l) => l.state))}
          onChange={(state) => setFilter({ state, city: undefined })}
        />
        <FilterSelect
          label="City"
          allLabel="All cities"
          value={filters.city}
          options={distinct(inState.map((l) => l.city))}
          onChange={(city) => setFilter({ city })}
        />
      </div>

      {list.isSuccess && rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UserCogIcon />
            </EmptyMedia>
            <EmptyTitle>
              {filtered ? "No Resource Roles match" : "No Resource Roles yet"}
            </EmptyTitle>
            <EmptyDescription>
              {filtered
                ? "Try another search or clear the filters."
                : canManage
                  ? "Create your first Resource Role or import a CSV."
                  : "An Admin adds Resource Roles here."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Bill rate / h</TableHead>
                <TableHead className="text-right">Cost rate / h</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((role) => (
                <TableRow key={role.id}>
                  <TableCell className="max-w-80">
                    <div className="font-medium">{role.name}</div>
                    {role.description && (
                      <div className="truncate text-muted-foreground">
                        {role.description}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(role.billRate, currencyCode)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(role.costRate, currencyCode)}
                  </TableCell>
                  <TableCell>
                    {[
                      role.locationCity,
                      role.locationState,
                      role.locationCountry,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </TableCell>
                  <TableCell>
                    {role.active ? (
                      <Badge variant="secondary">Active</Badge>
                    ) : (
                      <Badge variant="outline">Inactive</Badge>
                    )}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Actions for ${role.name}`}
                            />
                          }
                        >
                          <MoreHorizontalIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setDialog({ role })}>
                            <PencilIcon />
                            Edit
                          </DropdownMenuItem>
                          {role.active ? (
                            <DropdownMenuItem
                              onClick={() => deactivate.mutate({ id: role.id })}
                            >
                              <PowerOffIcon />
                              Deactivate
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() => reactivate.mutate({ id: role.id })}
                            >
                              <PowerIcon />
                              Reactivate
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setDeleting(role)}
                          >
                            <Trash2Icon />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))}
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
            description="Only Resource Roles never used on a Quote can be deleted; deactivate it to stop it being added instead."
            pending={remove.isPending}
            onConfirm={() => deleting && remove.mutate({ id: deleting.id })}
          />
        </>
      )}
    </>
  )
}
