"use client"

import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { PackageSearchIcon, SearchIcon } from "lucide-react"
import { useDeferredValue, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import type { SourceKind } from "@workspace/domain/enums"
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
import { Spinner } from "@workspace/ui/components/spinner"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { cn } from "@workspace/ui/lib/utils"

import { TagsFilter } from "@/components/catalog/tags-filter"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/shell/empty"
import { FilterSelect } from "@/components/shell/filter-select"
import { useActiveCatalogTypes } from "@/components/shell/catalog-types"
import type { CatalogTypeView } from "@/components/shell/catalog-types"
import { useLabels } from "@/components/shell/labels"
import { catalogTypeTone, LABOUR_TONE } from "@/components/shell/tints"
import { formatMoney } from "@/lib/money"
import type { PhaseOption } from "@/lib/phase-tree"
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
 * A tab of the Add Items sheet: an active Catalog Type's id, or
 * "resource_role".
 */
export type AddItemsTab = string

/**
 * The Add Items sheet: a tab per active Catalog Type (named and coloured by
 * the type, in order) plus Resource Roles (Label Override), each with filters
 * and an infinitely scrolling list of active items. Items picked on any
 * tab are added together, into the chosen Phase (any level; `phaseOptions`
 * in tree order), as one `lineItem.add`. The Phase is controlled, so "Add
 * items here" on a Phase row opens the sheet with it chosen.
 */
export function AddItemsSheet({
  open,
  onOpenChange,
  currency,
  phaseOptions,
  phaseId,
  onPhaseIdChange,
  pending,
  onAdd,
  initialTab,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currency: string
  phaseOptions: readonly PhaseOption[]
  phaseId: string | null
  onPhaseIdChange: (phaseId: string | null) => void
  pending: boolean
  onAdd: (
    input: { phaseId: string | null; items: Picked[] },
    done: () => void
  ) => void
  /** The tab it opens on (default: the first). */
  initialTab?: AddItemsTab
}) {
  const labels = useLabels()
  const catalogTypes = useActiveCatalogTypes()
  const tabs: {
    value: AddItemsTab
    label: string
    dot: string
    type?: CatalogTypeView
  }[] = [
    ...catalogTypes.map((type) => ({
      value: type.id,
      label: type.plural,
      dot: catalogTypeTone(type.colourIndex).dot,
      type,
    })),
    {
      value: "resource_role",
      label: labels.resource_role.plural,
      dot: LABOUR_TONE.dot,
    },
  ]
  const [tab, setTab] = useState<AddItemsTab>(
    initialTab && tabs.some((t) => t.value === initialTab)
      ? initialTab
      : tabs[0]!.value
  )
  const [selection, setSelection] = useState<Selection>(new Map())

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
    onAdd({ phaseId, items: [...selection.values()] }, () => {
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
            Pick {tabs.map((t) => t.label).join(", ")} to add as Line Items.
            Prices and costs are copied from the catalog now.
          </SheetDescription>
        </SheetHeader>
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as AddItemsTab)}
          className="min-h-0 flex-1 px-4"
        >
          <TabsList className="w-full">
            {tabs.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="min-w-0">
                <span
                  aria-hidden
                  className={cn("size-2 shrink-0 rounded-full", t.dot)}
                />
                <span className="truncate">{t.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.map((t) => (
            <TabsContent
              key={t.value}
              value={t.value}
              className="flex min-h-0 flex-col gap-2"
            >
              {!t.type ? (
                <ResourceRolePicker
                  currency={currency}
                  selection={selection}
                  onToggle={toggle}
                />
              ) : (
                <CatalogItemPicker
                  catalogType={t.type}
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
            value={phaseId ?? undefined}
            options={phaseOptions}
            onChange={(next) => onPhaseIdChange(next ?? null)}
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
  catalogType,
  currency,
  selection,
  onToggle,
}: {
  catalogType: CatalogTypeView
  currency: string
  selection: Selection
  onToggle: (item: Picked, on: boolean) => void
}) {
  const trpc = useTRPC()
  const catalogTypeId = catalogType.id
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search.trim())
  const [tags, setTags] = useState<string[]>([])
  const [billingUnit, setBillingUnit] = useState<"each" | "hour">()
  const tagOptions = useQuery(
    trpc.catalogItem.tags.queryOptions({ catalogTypeId })
  )
  const list = useInfiniteQuery(
    trpc.catalogItem.listForPicker.infiniteQueryOptions(
      {
        catalogTypeId,
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
          label={`Search ${catalogType.plural}`}
          value={search}
          onChange={setSearch}
        />
        <TagsFilter
          tags={tagOptions.data ?? []}
          selected={tags}
          onChange={setTags}
        />
        {catalogType.billingUnits.length > 1 && (
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
        empty={`No active ${catalogType.plural} match.`}
      >
        {rows.map((row) => {
          const item = {
            sourceKind: "catalog_item" as const,
            id: row.id,
            name: row.name,
          }
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
        <p className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
          <Spinner role={undefined} aria-hidden />
          Loading…
        </p>
      ) : children.length === 0 ? (
        <Empty className="py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PackageSearchIcon />
            </EmptyMedia>
            <EmptyDescription>{empty}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">{children}</ul>
      )}
      <div ref={endRef} aria-hidden className="h-1" />
      {fetchingMore && (
        <p className="flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground">
          <Spinner className="size-3" role={undefined} aria-hidden />
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
