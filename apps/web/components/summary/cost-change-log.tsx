"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { ArrowRightIcon } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { QUOTE_POLL_MS } from "@/components/quotes/autosave"
import { useLabels } from "@/components/shell/labels"
import { formatDateTime } from "@/lib/format"
import { formatMoney } from "@/lib/money"
import { useTRPC } from "@/trpc/react"

/**
 * The Quote's cost change log (`quote.costChangeLog`): each Line Item whose
 * Base Rate cost Cost Propagation rewrote while the Quote was a Draft, with
 * the source, old → new cost, who and when — why the margins moved. The
 * Summary tab prefetches it.
 */
export function CostChangeLog({ quoteId }: { quoteId: string }) {
  const trpc = useTRPC()
  const labels = useLabels()
  const { entries, currencyCode } = useSuspenseQuery({
    ...trpc.quote.costChangeLog.queryOptions({ id: quoteId }),
    refetchInterval: QUOTE_POLL_MS,
  }).data
  const money = (amount: string) => formatMoney(amount, currencyCode)
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
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No costs have changed since the lines were added.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Line</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead>Changed by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium">
                    {entry.lineName}
                  </TableCell>
                  <TableCell>
                    {entry.sourceName}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {labels[entry.sourceKind].singular}
                    </span>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    <span className="text-muted-foreground line-through">
                      {money(entry.oldCost)}
                    </span>
                    <ArrowRightIcon
                      className="mx-1 inline size-3.5 text-muted-foreground"
                      aria-label="to"
                    />
                    {money(entry.newCost)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {entry.actor.name ?? entry.actor.email}
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(entry.createdAt)}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
