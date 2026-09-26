"use client"

/**
 * The list toolbar controls, built on niko-table's public pieces without
 * editing the vendored files (see "UI component policy" in AGENTS.md):
 *
 * - `SearchFilter` is a shadcn `InputGroup` bound to the table's global
 *   filter (niko's search input hard-codes its accessible name).
 * - `FacetedFilter` is a shadcn `Popover` with a real `Button` trigger
 *   around niko's `DataTableFacetedFilterContent` (niko's own trigger nests
 *   a `<button>` in the popover's `<button>`).
 * - `DateRangeFilter` is niko's; `ColumnsMenu` / `ColumnsDndMenu` use our
 *   clones of niko's view menus (columns-view-*.tsx). All
 *   components with a `TriggerFace` as `trigger`: niko renders the trigger
 *   inside its own `<button>`, so the face is a `<span>` that looks like a
 *   Button (globals.css makes that `<button>` a bare hit target).
 */
import type { RowData } from "@tanstack/react-table"
import {
  CalendarIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  Columns3Icon,
  PlusCircleIcon,
  SearchIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react"
import { useState } from "react"

import { Badge } from "@workspace/ui/components/badge"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@workspace/ui/components/command"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { DataTableDateFilter } from "@workspace/ui/components/niko-table/components/data-table-date-filter"
import { DataTableFacetedFilterContent } from "@workspace/ui/components/niko-table/components/data-table-faceted-filter"
import { useDataTable } from "@workspace/ui/components/niko-table/core/data-table-context"
import { useTableFacetedFilter } from "@workspace/ui/components/niko-table/filters/table-faceted-filter"
import { useDerivedColumnTitle } from "@workspace/ui/components/niko-table/hooks/use-derived-column-title"
import { formatDate } from "@workspace/ui/components/niko-table/lib/format"
import type {
  DataTableColumn,
  Option,
} from "@workspace/ui/components/niko-table/types"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { Separator } from "@workspace/ui/components/separator"
import { cn } from "@workspace/ui/lib/utils"

import { ColumnsViewDndMenu } from "./columns-view-dnd-menu"
import { ColumnsViewMenu } from "./columns-view-menu"

/**
 * Looks like a `Button` but is a `<span>`, for a niko trigger slot that is
 * already inside a `<button>` (`PopoverTrigger` children). The focus ring
 * follows the enclosing button's focus.
 */
export function TriggerFace({
  variant = "outline",
  size = "sm",
  className,
  ...props
}: React.ComponentProps<"span"> & {
  variant?: "outline" | "ghost" | "secondary"
  size?: "sm" | "default"
}) {
  return (
    <span
      data-slot="trigger-face"
      className={cn(
        buttonVariants({ variant, size }),
        "in-focus-visible:border-ring in-focus-visible:ring-3 in-focus-visible:ring-ring/50",
        className
      )}
      {...props}
    />
  )
}

/**
 * The list's search box, bound to the table's global filter (the query's
 * search input on server lists). `aria-label` names what it searches.
 */
export function SearchFilter({
  "aria-label": ariaLabel,
  placeholder,
  className,
}: {
  "aria-label": string
  placeholder?: string
  className?: string
}) {
  const { table } = useDataTable()
  const raw = table.state.globalFilter
  const value = typeof raw === "string" ? raw : ""
  return (
    <InputGroup role="search" className={className}>
      <InputGroupAddon>
        <SearchIcon aria-hidden />
      </InputGroupAddon>
      <InputGroupInput
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        onChange={(event) => table.setGlobalFilter(event.target.value)}
      />
      {value.length > 0 && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label="Clear search"
            onClick={() => table.setGlobalFilter("")}
          >
            <XIcon />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}

/** The selected values of a niko faceted filter (array, value or `{ value }`). */
function selectedFacetValues(filter: unknown): Set<string> {
  if (filter === undefined || filter === null) return new Set()
  const value =
    typeof filter === "object" && !Array.isArray(filter) && "value" in filter
      ? (filter as { value: unknown }).value
      : filter
  return new Set((Array.isArray(value) ? value : [value]).map(String))
}

/**
 * A faceted (pick from a list) filter on one column: the dashed toolbar
 * button with the chosen values, opening niko's option list. On server
 * lists pass static `options` with `showCounts={false}` and
 * `limitToFilteredRows={false}` (only one page is loaded). `groups` lists
 * the options under headings instead (e.g. Quote Statuses by Stage); niko's
 * option list has no groups, so they render in a shadcn `Command` driven by
 * niko's `useTableFacetedFilter`.
 */
export function FacetedFilter<TData extends RowData>({
  accessorKey,
  title,
  options: optionList,
  multiple = false,
  showCounts,
  limitToFilteredRows,
  groups,
}: {
  accessorKey: keyof TData & string
  title?: string
  options?: Option[]
  multiple?: boolean
  showCounts?: boolean
  limitToFilteredRows?: boolean
  groups?: { heading: string; options: Option[] }[]
}) {
  const options = groups
    ? groups.flatMap((group) => group.options)
    : (optionList ?? [])
  const [open, setOpen] = useState(false)
  const { table } = useDataTable<TData>()
  const column = table.getColumn(accessorKey)
  const derivedTitle = useDerivedColumnTitle(column, accessorKey, title)
  if (!column) return null
  const selected = selectedFacetValues(column.getFilterValue())
  const chosen = options.filter((option) => selected.has(option.value))
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="h-8 border-dashed" />
        }
      >
        {selected.size > 0 ? (
          // A pointer shortcut; keyboard users clear from the list.
          <span
            aria-hidden
            onClick={(event) => {
              event.stopPropagation()
              column.setFilterValue(undefined)
            }}
            className="rounded-sm opacity-70 transition-opacity hover:opacity-100"
          >
            <XCircleIcon className="size-4" />
          </span>
        ) : (
          <PlusCircleIcon className="size-4" />
        )}
        {derivedTitle}
        {selected.size > 0 && (
          <>
            <Separator orientation="vertical" className="mx-2 h-4" />
            <Badge
              variant="secondary"
              className="rounded-sm px-1 font-normal lg:hidden"
            >
              {selected.size}
            </Badge>
            <span className="hidden items-center gap-1 lg:flex">
              {chosen.length > 2 ? (
                <Badge
                  variant="secondary"
                  className="rounded-sm px-1 font-normal"
                >
                  {chosen.length} selected
                </Badge>
              ) : (
                chosen.map((option) => (
                  <Badge
                    key={option.value}
                    variant="secondary"
                    className="rounded-sm px-1 font-normal"
                  >
                    {option.label}
                  </Badge>
                ))
              )}
            </span>
          </>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-52 p-0" align="start">
        {groups ? (
          <GroupedFacetedOptions<TData>
            column={column}
            title={derivedTitle}
            groups={groups}
            multiple={multiple}
            onValueChange={() => {
              if (!multiple) setOpen(false)
            }}
          />
        ) : (
          <DataTableFacetedFilterContent<TData>
            accessorKey={accessorKey}
            title={derivedTitle}
            options={options}
            multiple={multiple}
            showCounts={showCounts}
            limitToFilteredRows={limitToFilteredRows}
            onValueChange={() => {
              if (!multiple) setOpen(false)
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

/** A faceted filter's option list under headings (`FacetedFilter groups`). */
function GroupedFacetedOptions<TData extends RowData>({
  column,
  title,
  groups,
  multiple,
  onValueChange,
}: {
  column: DataTableColumn<TData, unknown>
  title?: string
  groups: { heading: string; options: Option[] }[]
  multiple: boolean
  onValueChange: () => void
}) {
  const { selectedValues, onItemSelect, onReset } = useTableFacetedFilter({
    column,
    multiple,
    onValueChange,
  })
  return (
    <Command>
      <CommandInput placeholder={title} className="pl-2" />
      <CommandList className="max-h-80">
        <CommandEmpty>No results found.</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group.heading} heading={group.heading}>
            {group.options.map((option) => {
              const isSelected = selectedValues.has(option.value)
              return (
                <CommandItem
                  key={option.value}
                  value={`${group.heading} ${option.label}`}
                  onSelect={() => onItemSelect(option, isSelected)}
                  data-checked={isSelected}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-4 items-center justify-center border border-primary",
                      isSelected
                        ? "bg-primary text-primary-foreground"
                        : "opacity-50 [&_svg]:invisible"
                    )}
                  >
                    <CheckIcon className="size-3.5" />
                  </span>
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              )
            })}
          </CommandGroup>
        ))}
        {selectedValues.size > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                onSelect={() => onReset()}
                className="justify-center text-center"
              >
                Clear filters
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </Command>
  )
}

/** The `[fromMs, toMs]` a niko date-range filter keeps. */
function dateRangeOf(filter: unknown): [Date | undefined, Date | undefined] {
  const at = (value: unknown) =>
    typeof value === "number" || typeof value === "string"
      ? new Date(Number(value))
      : undefined
  return Array.isArray(filter)
    ? [at(filter[0]), at(filter[1])]
    : [undefined, undefined]
}

/**
 * niko's date-range filter on one column (value `[fromMs, toMs]` of local
 * midnights), with the toolbar's dashed trigger.
 */
export function DateRangeFilter<TData extends RowData>({
  accessorKey,
  title,
}: {
  accessorKey: keyof TData & string
  title?: string
}) {
  const { table } = useDataTable<TData>()
  const column = table.getColumn(accessorKey)
  const derivedTitle = useDerivedColumnTitle(column, accessorKey, title)
  if (!column) return null
  const [from, to] = dateRangeOf(column.getFilterValue())
  const range =
    from && to
      ? `${formatDate(from)} - ${formatDate(to)}`
      : from || to
        ? formatDate((from ?? to) as Date)
        : null
  return (
    <DataTableDateFilter<TData>
      accessorKey={accessorKey}
      title={derivedTitle}
      multiple
      trigger={
        <TriggerFace className="h-8 border-dashed">
          {range ? (
            // A pointer shortcut; keyboard users clear in the calendar.
            <span
              aria-hidden
              onClick={(event) => {
                event.stopPropagation()
                column.setFilterValue(undefined)
              }}
              className="rounded-sm opacity-70 transition-opacity hover:opacity-100"
            >
              <XCircleIcon className="size-4" />
            </span>
          ) : (
            <CalendarIcon className="size-4" />
          )}
          <span className="flex items-center gap-2">
            <span>{derivedTitle}</span>
            {range && (
              <>
                <Separator
                  orientation="vertical"
                  className="mx-0.5 data-[orientation=vertical]:h-4"
                />
                <span>{range}</span>
              </>
            )}
          </span>
        </TriggerFace>
      }
    />
  )
}

/** The face of the Columns menus' trigger. */
function ColumnsFace() {
  return (
    <TriggerFace>
      <Columns3Icon data-icon="inline-start" />
      Columns
      <ChevronsUpDownIcon data-icon="inline-end" className="opacity-50" />
    </TriggerFace>
  )
}

/**
 * The toolbar's "Columns" menu (niko's view menu): show or hide the
 * table's optional columns, e.g. a Description hidden by default. Columns
 * with `enableHiding: false` (the Name, filter-only columns) aren't listed.
 */
export function ColumnsMenu() {
  const { table } = useDataTable()
  return (
    <div className="ml-auto">
      <ColumnsViewMenu table={table} trigger={<ColumnsFace />} />
    </div>
  )
}

/**
 * The Columns menu with drag-to-reorder (niko's view DnD menu), for a list
 * that saves its column layout. `columnOrder` is the movable columns'
 * order; `onReset` restores the default layout.
 */
export function ColumnsDndMenu({
  columnOrder,
  onColumnOrderChange,
  onReset,
}: {
  columnOrder: string[]
  onColumnOrderChange: (order: string[]) => void
  onReset: () => void
}) {
  const { table } = useDataTable()
  return (
    <div className="ml-auto">
      <ColumnsViewDndMenu
        table={table}
        columnOrder={columnOrder}
        onColumnOrderChange={onColumnOrderChange}
        onReset={onReset}
        trigger={<ColumnsFace />}
      />
    </div>
  )
}
