"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import type { RouterOutputs } from "@workspace/api"
import { ArrowRightIcon, HistoryIcon } from "lucide-react"
import { createContext, useContext } from "react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import type { DataTableColumns } from "@workspace/ui/components/niko-table/types"

import { QUOTE_POLL_MS } from "@/components/quotes/autosave"
import {
  ColumnTitle,
  ListTable,
  LocalTableRoot,
  SortableColumnTitle,
} from "@/components/shell/data-table"
import { useLabels } from "@/components/shell/labels"
import { formatDateTime } from "@/lib/format"
import { formatMoney } from "@/lib/money"
import { useTRPC } from "@/trpc/react"

type CostChange = RouterOutputs["quote"]["costChangeLog"]["entries"][number]
type CostChangeCell = { row: { original: CostChange } }

const CurrencyContext = createContext("USD")

function SourceCell({ row }: CostChangeCell) {
  const labels = useLabels()
  return (
    <>
      {row.original.sourceName}
      <span className="ml-1 text-xs text-muted-foreground">
        {labels[row.original.sourceKind].singular}
      </span>
    </>
  )
}

function CostCell({ row }: CostChangeCell) {
  const currency = useContext(CurrencyContext)
  const money = (amount: string) => formatMoney(amount, currency)
  return (
    <div className="text-right tabular-nums">
      <span className="text-muted-foreground line-through">
        {money(row.original.oldCost)}
      </span>
      <ArrowRightIcon
        className="mx-1 inline size-3.5 text-muted-foreground"
        aria-label="to"
      />
      {money(row.original.newCost)}
    </div>
  )
}

const columns: DataTableColumns<CostChange> = [
  {
    id: "lineName",
    accessorKey: "lineName",
    header: SortableColumnTitle,
    meta: { label: "Line" },
    cell: ({ row }) => (
      <span className="font-medium">{row.original.lineName}</span>
    ),
  },
  {
    id: "sourceName",
    accessorKey: "sourceName",
    header: SortableColumnTitle,
    meta: { label: "Source" },
    cell: SourceCell,
  },
  {
    id: "cost",
    header: ColumnTitle,
    meta: { label: "Cost", align: "end" },
    cell: CostCell,
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: SortableColumnTitle,
    meta: { label: "Changed by" },
    cell: ({ row }) => (
      <div className="text-sm">
        {row.original.actor.name ?? row.original.actor.email}
        <div className="text-xs text-muted-foreground">
          {formatDateTime(row.original.createdAt)}
        </div>
      </div>
    ),
  },
]

/**
 * The Quote's cost change log (`quote.costChangeLog`): each Line Item whose
 * Base Rate cost Cost Propagation rewrote while the Quote was a Draft, with
 * the source, old → new cost, who and when — why the margins moved. The
 * Summary tab prefetches it.
 */
export function CostChangeLog({ quoteId }: { quoteId: string }) {
  const trpc = useTRPC()
  const { entries, currencyCode } = useSuspenseQuery({
    ...trpc.quote.costChangeLog.queryOptions({ id: quoteId }),
    refetchInterval: QUOTE_POLL_MS,
  }).data
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cost changes</CardTitle>
        <CardDescription>
          Catalog cost changes applied to this Quote while it was a Draft.
          Prices never change.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CurrencyContext value={currencyCode}>
          <LocalTableRoot columns={columns} data={entries} sortable>
            <ListTable
              empty={{
                icon: <HistoryIcon />,
                title: "No cost changes",
                description:
                  "No costs have changed since the lines were added.",
              }}
            />
          </LocalTableRoot>
        </CurrencyContext>
      </CardContent>
    </Card>
  )
}
