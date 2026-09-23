"use client"

import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { PackageSearchIcon, SearchIcon } from "lucide-react"
import { useDeferredValue, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import type { CatalogItemKind, SourceKind } from "@workspace/domain/enums"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"

import { TagsFilter } from "@/components/catalog/tags-filter"
import { FilterSelect } from "@/components/shell/filter-select"
import { useLabels } from "@/components/shell/labels"
import { formatMoney } from "@/lib/money"
import { useTRPC } from "@/trpc/react"

/** One picked source. */
interface Picked {
  sourceKind: SourceKind
  id: string
  name: string
}

type Selection = Map<string, Picked>
const keyOf = (p: { sourceKind: SourceKind; id: string }) =>
  `${p.sourceKind}:${p.id}`

const BILLING_OPTIONS = [
  { value: "each", label: "Each" },
  { value: "hour", label: "Hour" },
] as const

/**
 * The Add Items sheet: tabs for Products, Add-ons and Resource Roles (with
 * the Organization's labels; hidden terms have no tab), each with filters
 * and an infinitely scrolling list of active items. Items picked on any
 * tab are added together, into the chosen Phase, as one `lineItem.add`.
 */
export function AddItemsSheet({
  open,
  onOpenChange,
  currency,
  phases,
  pending,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currency: string
  phases: { id: string; name: string }[]
  pending: boolean
  onAdd: (
    input: { phaseId: string | null; items: Picked[] },
    done: () => void
  ) => void
}) {
  const labels = useLabels()
  const tabs = (["product", "add_on", "resource_role"] as const).filter(
    (term) => labels[term].enabled
  )
  const [tab, setTab] = useState<SourceKind>(tabs[0] ?? "resource_role")
  const [selection, setSelection] = useState<Selection>(new Map())
  const [phaseId, setPhaseId] = useState<string | undefined>()

  const toggle = (item: Picked, on: boolean) =>
    setSelection((current) => {
      const next = new Map(current)
      if (on) next.set(keyOf(item), item)
      else next.delete(keyOf(item))
      return next
    })

  const close = (next: boolean) => {
    if (!next) setSelection(new Map())
    onOpenChange(next)
  }

  const add = () =>
    onAdd({ phaseId: phaseId ?? null, items: [...selection.values()] }, () => {
      toast.success(
        selection.size === 1
          ? `Added “${[...selection.values()][0]!.name}”.`
          : `Added ${selection.size} Line Items.`
      )
      close(false)
    })

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent className="w-full gap-0 sm:max-w-xl data-[side=right]:sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Add items</SheetTitle>
          <SheetDescription>
            Pick {tabs.map((t) => labels[t].plural).join(", ")} to add as Line
            Items. Prices and costs are copied from the catalog now.
          </SheetDescription>
        </SheetHeader>
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as SourceKind)}
          className="min-h-0 flex-1 px-4"
        >
          <TabsList className="w-full">
            {tabs.map((term) => (
              <TabsTrigger key={term} value={term}>
                {labels[term].plural}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.map((term) => (
            <TabsContent
              key={term}
              value={term}
              className="flex min-h-0 flex-col gap-2"
            >
              {term === "resource_role" ? (
                <ResourceRolePicker
                  currency={currency}
                  selection={selection}
                  onToggle={toggle}
                />
              ) : (
                <CatalogItemPicker
                  kind={term}
                  currency={currency}
                  selection={selection}
                  onToggle={toggle}
                />
              )}
            </TabsContent>
          ))}
        </Tabs>
        <SheetFooter className="flex-row items-center justify-between gap-2 border-t">
          <FilterSelect
            label={`Add to ${labels.phase.singular}`}
            allLabel={`No ${labels.phase.singular}`}
            className="w-48"
            value={phaseId}
            options={phases.map((p) => ({ value: p.id, label: p.name }))}
            onChange={setPhaseId}
          />
          <Button disabled={selection.size === 0 || pending} onClick={add}>
            {pending
              ? "Adding…"
              : selection.size === 0
                ? "Add"
                : `Add ${selection.size} item${selection.size === 1 ? "" : "s"}`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function SearchInput({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (value: string) => void
  label: string
}) {
  return (
    <InputGroup className="flex-1">
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        aria-label={label}
        placeholder="Search name or description"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </InputGroup>
  )
}

function CatalogItemPicker({
  kind,
  currency,
  selection,
  onToggle,
}: {
  kind: CatalogItemKind
  currency: string
  selection: Selection
  onToggle: (item: Picked, on: boolean) => void
}) {
  const trpc = useTRPC()
  const labels = useLabels()
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search.trim())
  const [tags, setTags] = useState<string[]>([])
  const [billingUnit, setBillingUnit] = useState<"each" | "hour">()
  const tagOptions = useQuery(trpc.catalogItem.tags.queryOptions({ kind }))
  const list = useInfiniteQuery(
    trpc.catalogItem.listForPicker.infiniteQueryOptions(
      {
        kind,
        ...(deferredSearch ? { search: deferredSearch } : {}),
        ...(tags.length ? { tags } : {}),
        ...(billingUnit ? { billingUnit } : {}),
      },
      { getNextPageParam: (page) => page.nextCursor }
    )
  )
  const rows = list.data?.pages.flatMap((p) => p.rows) ?? []

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          label={`Search ${labels[kind].plural}`}
          value={search}
          onChange={setSearch}
        />
        <TagsFilter
          tags={tagOptions.data ?? []}
          selected={tags}
          onChange={setTags}
        />
        {kind === "add_on" && (
          <FilterSelect
            label="Billing unit"
            allLabel="Any unit"
            className="w-32"
            value={billingUnit}
            options={BILLING_OPTIONS}
            onChange={(v) => setBillingUnit(v as "each" | "hour" | undefined)}
          />
        )}
      </div>
      <PickerList
        loading={list.isPending}
        hasMore={list.hasNextPage}
        fetchingMore={list.isFetchingNextPage}
        onLoadMore={() => void list.fetchNextPage()}
        empty={`No active ${labels[kind].plural} match.`}
      >
        {rows.map((row) => {
          const item = { sourceKind: kind, id: row.id, name: row.name }
          return (
            <PickerRow
              key={row.id}
              checked={selection.has(keyOf(item))}
              onCheckedChange={(on) => onToggle(item, on)}
              name={row.name}
              detail={[row.description, row.tags.join(", ")]
                .filter(Boolean)
                .join(" · ")}
              price={`${formatMoney(row.price, currency)} / ${row.billingUnit === "hour" ? "hour" : "each"}`}
            />
          )
        })}
      </PickerList>
    </>
  )
}

function ResourceRolePicker({
  currency,
  selection,
  onToggle,
}: {
  currency: string
  selection: Selection
  onToggle: (item: Picked, on: boolean) => void
}) {
  const trpc = useTRPC()
  const labels = useLabels()
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search.trim())
  const [country, setCountry] = useState<string>()
  const locations = useQuery(trpc.resourceRole.locations.queryOptions())
  const countries = [
    ...new Set((locations.data ?? []).flatMap((l) => l.country ?? [])),
  ]
  const list = useInfiniteQuery(
    trpc.resourceRole.listForPicker.infiniteQueryOptions(
      {
        ...(deferredSearch ? { search: deferredSearch } : {}),
        ...(country ? { country } : {}),
      },
      { getNextPageParam: (page) => page.nextCursor }
    )
  )
  const rows = list.data?.pages.flatMap((p) => p.rows) ?? []

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          label={`Search ${labels.resource_role.plural}`}
          value={search}
          onChange={setSearch}
        />
        <FilterSelect
          label="Country"
          allLabel="Any location"
          className="w-40"
          value={country}
          options={countries.map((c) => ({ value: c, label: c }))}
          onChange={setCountry}
        />
      </div>
      <PickerList
        loading={list.isPending}
        hasMore={list.hasNextPage}
        fetchingMore={list.isFetchingNextPage}
        onLoadMore={() => void list.fetchNextPage()}
        empty={`No active ${labels.resource_role.plural} match.`}
      >
        {rows.map((row) => {
          const item = {
            sourceKind: "resource_role" as const,
            id: row.id,
            name: row.name,
          }
          return (
            <PickerRow
              key={row.id}
              checked={selection.has(keyOf(item))}
              onCheckedChange={(on) => onToggle(item, on)}
              name={row.name}
              detail={[
                row.description,
                [row.locationCity, row.locationState, row.locationCountry]
                  .filter(Boolean)
                  .join(", "),
              ]
                .filter(Boolean)
                .join(" · ")}
              price={`${formatMoney(row.billRate, currency)} / hour`}
            />
          )
        })}
      </PickerList>
    </>
  )
}

/**
 * A scrolling list that asks for the next page when its end scrolls into
 * view (infinite scroll).
 */
function PickerList({
  loading,
  hasMore,
  fetchingMore,
  onLoadMore,
  empty,
  children,
}: {
  loading: boolean
  hasMore: boolean
  fetchingMore: boolean
  onLoadMore: () => void
  empty: string
  children: React.ReactNode[]
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const loadMore = useRef(onLoadMore)
  useEffect(() => {
    loadMore.current = onLoadMore
  })
  useEffect(() => {
    const end = endRef.current
    if (!end || !hasMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore.current()
      },
      { root: scrollRef.current, rootMargin: "200px" }
    )
    observer.observe(end)
    return () => observer.disconnect()
  }, [hasMore, children.length])

  return (
    <div
      ref={scrollRef}
      className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-2"
      style={{ maxHeight: "calc(100dvh - 17rem)" }}
    >
      {loading ? (
        <p className="py-8 text-center text-muted-foreground">Loading…</p>
      ) : children.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
          <PackageSearchIcon className="size-6" aria-hidden />
          {empty}
        </div>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">{children}</ul>
      )}
      <div ref={endRef} aria-hidden className="h-1" />
      {fetchingMore && (
        <p className="py-2 text-center text-xs text-muted-foreground">
          Loading more…
        </p>
      )}
    </div>
  )
}

function PickerRow({
  checked,
  onCheckedChange,
  name,
  detail,
  price,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  name: string
  detail: string
  price: string
}) {
  return (
    <li>
      <label className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-muted/50">
        <Checkbox
          className="mt-0.5"
          checked={checked}
          onCheckedChange={(on) => onCheckedChange(on === true)}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">{name}</span>
          {detail && (
            <span className="truncate text-xs text-muted-foreground">
              {detail}
            </span>
          )}
        </span>
        <span className="shrink-0 text-sm tabular-nums">{price}</span>
      </label>
    </li>
  )
}
