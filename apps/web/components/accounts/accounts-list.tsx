"use client"

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  Building2Icon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useDeferredValue, useState } from "react"
import { toast } from "sonner"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
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
import { errorMessage } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

import { AccountDialog } from "./account-dialog"
import { INITIAL_ACCOUNT_LIST_INPUT } from "./list-input"
import type { AccountListInput } from "./list-input"

const STATUS_OPTIONS = [
  { value: "archived", label: "Archived" },
  { value: "all", label: "Active and archived" },
] as const

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

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<{
    ids: string[]
    label: string
  } | null>(null)

  const setFilter = (changes: Partial<AccountListInput>) => {
    setFilters((f) => ({ ...f, ...changes, page: changes.page ?? 1 }))
    setSelected(new Set())
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
        setSelected(new Set())
        setDeleting(null)
        await invalidate()
      },
      onError: (e) => {
        setDeleting(null)
        toast.error(errorMessage(e))
      },
    })
  )

  const rows = list.data?.rows ?? []
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const toggleAll = (checked: boolean) =>
    setSelected(checked ? new Set(rows.map((r) => r.id)) : new Set())
  const toggle = (id: string, checked: boolean) =>
    setSelected((s) => {
      const next = new Set(s)
      if (checked) next.add(id)
      else next.delete(id)
      return next
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

      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="w-full sm:w-64">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search Accounts"
            placeholder="Search name, industry, website"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setFilter({})
            }}
          />
        </InputGroup>
        <FilterSelect
          label="Type"
          allLabel="All types"
          value={filters.type}
          options={(options.data?.types ?? []).map((t) => ({
            value: t,
            label: t,
          }))}
          onChange={(type) => setFilter({ type })}
        />
        <FilterSelect
          label="Industry"
          allLabel="All industries"
          value={filters.industry}
          options={(options.data?.industries ?? []).map((i) => ({
            value: i,
            label: i,
          }))}
          onChange={(industry) => setFilter({ industry })}
        />
        <FilterSelect
          label="Archived"
          allLabel="Active"
          className="w-48"
          value={filters.status === "active" ? undefined : filters.status}
          options={STATUS_OPTIONS}
          onChange={(status) =>
            setFilter({
              status: (status ?? "active") as AccountListInput["status"],
            })
          }
        />
        {selected.size > 0 && (
          <Button
            variant="destructive"
            className="ml-auto"
            onClick={() =>
              setDeleting({
                ids: [...selected],
                label:
                  selected.size === 1
                    ? "the selected Account"
                    : `${selected.size} Accounts`,
              })
            }
          >
            <Trash2Icon data-icon="inline-start" />
            Delete {selected.size}
          </Button>
        )}
      </div>

      {list.isSuccess && rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Building2Icon />
            </EmptyMedia>
            <EmptyTitle>
              {filtered ? "No Accounts match" : "No Accounts yet"}
            </EmptyTitle>
            <EmptyDescription>
              {filtered
                ? "Try another search or clear the filters."
                : "Create the first company you quote."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all on this page"
                    checked={allSelected}
                    onCheckedChange={(c) => toggleAll(c === true)}
                  />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Primary Contact</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((account) => (
                <TableRow
                  key={account.id}
                  data-state={selected.has(account.id) ? "selected" : undefined}
                >
                  <TableCell>
                    <Checkbox
                      aria-label={`Select ${account.name}`}
                      checked={selected.has(account.id)}
                      onCheckedChange={(c) => toggle(account.id, c === true)}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link
                      href={`/accounts/${account.id}`}
                      className="hover:underline"
                    >
                      {account.name}
                    </Link>
                    {account.archived && (
                      <Badge variant="secondary" className="ml-2">
                        Archived
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{account.type}</TableCell>
                  <TableCell>{account.industry}</TableCell>
                  <TableCell>
                    {[
                      account.billingCity,
                      account.billingState,
                      account.billingCountry,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </TableCell>
                  <TableCell>
                    {account.primaryContact?.name ?? (
                      <span className="text-muted-foreground">
                        {account.contactCount === 0 ? "—" : "None set"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Actions for ${account.name}`}
                          />
                        }
                      >
                        <MoreHorizontalIcon />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => router.push(`/accounts/${account.id}`)}
                        >
                          Open
                        </DropdownMenuItem>
                        {account.archived ? (
                          <DropdownMenuItem
                            onClick={() => unarchive.mutate({ id: account.id })}
                          >
                            <ArchiveRestoreIcon />
                            Unarchive
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() => archive.mutate({ id: account.id })}
                          >
                            <ArchiveIcon />
                            Archive
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() =>
                            setDeleting({
                              ids: [account.id],
                              label: `“${account.name}”`,
                            })
                          }
                        >
                          <Trash2Icon />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
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
