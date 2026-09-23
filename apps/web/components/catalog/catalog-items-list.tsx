"use client"

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  MoreHorizontalIcon,
  PackageIcon,
  PencilIcon,
  PlusIcon,
  PowerIcon,
  PowerOffIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react"
import { useDeferredValue, useState } from "react"
import { toast } from "sonner"

import type { RouterOutputs } from "@workspace/api"
import type { CatalogItemKind } from "@workspace/domain/enums"
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

import { ConfirmDialog } from "@/components/shell/confirm-dialog"
import { FilterSelect } from "@/components/shell/filter-select"
import { ListPagination } from "@/components/shell/list-pagination"
import { PageHeader } from "@/components/shell/page-header"
import { formatMoney } from "@/lib/money"
import { errorMessage } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

import { CatalogItemDialog } from "./catalog-item-dialog"
import { BILLING_UNIT_LABELS, KIND_LABELS, STATUS_OPTIONS } from "./labels"
import { initialCatalogItemListInput } from "./list-input"
import type { CatalogItemListInput } from "./list-input"
import { PriceRangeFilter } from "./price-range-filter"
import { TagsFilter } from "./tags-filter"

type CatalogItem = RouterOutputs["catalogItem"]["list"]["rows"][number]

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
  const label = KIND_LABELS[kind]

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

  const rows = list.data?.rows ?? []
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

      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="w-full sm:w-64">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label={`Search ${label.plural}`}
            placeholder="Search name or description"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setFilter({})
            }}
          />
        </InputGroup>
        {kind === "add_on" && (
          <FilterSelect
            label="Billing unit"
            allLabel="Any billing unit"
            value={filters.billingUnit}
            options={[
              { value: "each", label: "Each" },
              { value: "hour", label: "Hour" },
            ]}
            onChange={(v) =>
              setFilter({
                billingUnit: v as CatalogItemListInput["billingUnit"],
              })
            }
          />
        )}
        <FilterSelect
          label="Status"
          allLabel="Active and inactive"
          className="w-44"
          value={filters.status === "all" ? undefined : filters.status}
          options={STATUS_OPTIONS}
          onChange={(v) =>
            setFilter({
              status: (v ?? "all") as CatalogItemListInput["status"],
            })
          }
        />
        <PriceRangeFilter
          label="price"
          onChange={({ min, max }) =>
            setFilter({ minPrice: min, maxPrice: max })
          }
        />
        <TagsFilter
          tags={tags.data ?? []}
          selected={filters.tags ?? []}
          onChange={(t) => setFilter({ tags: t.length > 0 ? t : undefined })}
        />
      </div>

      {list.isSuccess && rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PackageIcon />
            </EmptyMedia>
            <EmptyTitle>
              {filtered ? `No ${label.plural} match` : `No ${label.plural} yet`}
            </EmptyTitle>
            <EmptyDescription>
              {filtered
                ? "Try another search or clear the filters."
                : canManage
                  ? `Create your first ${label.singular} or import a CSV.`
                  : `An Admin adds ${label.plural} here.`}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead>Billing unit</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="max-w-80">
                    <div className="font-medium">{item.name}</div>
                    {item.description && (
                      <div className="truncate text-muted-foreground">
                        {item.description}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(item.price, currencyCode)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(item.cost, currencyCode)}
                  </TableCell>
                  <TableCell>{BILLING_UNIT_LABELS[item.billingUnit]}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {item.tags.map((tag) => (
                        <Badge key={tag} variant="outline">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    {item.active ? (
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
                              aria-label={`Actions for ${item.name}`}
                            />
                          }
                        >
                          <MoreHorizontalIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setDialog({ item })}>
                            <PencilIcon />
                            Edit
                          </DropdownMenuItem>
                          {item.active ? (
                            <DropdownMenuItem
                              onClick={() => deactivate.mutate({ id: item.id })}
                            >
                              <PowerOffIcon />
                              Deactivate
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() => reactivate.mutate({ id: item.id })}
                            >
                              <PowerIcon />
                              Reactivate
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setDeleting(item)}
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
