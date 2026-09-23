"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { ClipboardCheckIcon } from "lucide-react"
import Link from "next/link"
import { startTransition, useState } from "react"

import { Decimal } from "@workspace/domain/money"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { QUOTE_POLL_MS } from "@/components/quotes/autosave"
import { ListPagination } from "@/components/shell/list-pagination"
import { PageHeader } from "@/components/shell/page-header"
import { daysSince, formatDate } from "@/lib/format"
import { formatMoney } from "@/lib/money"
import { useTRPC } from "@/trpc/react"

import { AWAITING_PAGE_SIZE } from "./list-input"

/** "today", "1 day", "4 days". */
function waited(submittedAt: Date | null) {
  if (!submittedAt) return "—"
  const days = daysSince(submittedAt)
  return days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`
}

/**
 * "Awaiting my approval" (`quote.awaitingMyApproval`): the Pending Approval
 * Quotes an Approver may decide (never their own), longest-waiting first.
 * Opening one shows Approve / Reject in its header.
 */
export function AwaitingApprovalList() {
  const trpc = useTRPC()
  const [page, setPage] = useState(1)
  // Suspends (the page prefetches page 1); page changes run in a
  // transition, so the current page stays visible while the next loads.
  const { data } = useSuspenseQuery({
    ...trpc.quote.awaitingMyApproval.queryOptions({
      page,
      pageSize: AWAITING_PAGE_SIZE,
    }),
    refetchOnWindowFocus: true,
    refetchInterval: QUOTE_POLL_MS,
  })
  const rows = data.rows

  return (
    <>
      <PageHeader
        title="Awaiting my approval"
        description="Quotes submitted by others that you can approve or reject."
      />
      {data.total === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClipboardCheckIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing awaits your approval</EmptyTitle>
            <EmptyDescription>
              Quotes appear here when their Owners submit them.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quote</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Margin %</TableHead>
                  <TableHead>Waiting</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-72">
                      <Link
                        href={`/quotes/${row.id}/summary`}
                        className="font-medium hover:underline"
                      >
                        {row.name}
                      </Link>
                      {row.submitComment && (
                        <p className="truncate text-xs text-muted-foreground">
                          {row.submitComment}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>{row.account.name}</TableCell>
                    <TableCell>{row.owner.name ?? row.owner.email}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(row.startDate)} – {formatDate(row.endDate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.total, row.currencyCode)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {new Decimal(row.marginPct).toFixed(1)}%
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {waited(row.submittedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ListPagination
            page={page}
            pageSize={AWAITING_PAGE_SIZE}
            total={data.total}
            onPageChange={(next) => startTransition(() => setPage(next))}
          />
        </div>
      )}
    </>
  )
}
