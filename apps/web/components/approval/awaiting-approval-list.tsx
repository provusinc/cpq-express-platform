"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { ClipboardCheckIcon } from "lucide-react"
import Link from "next/link"
import { startTransition, useState } from "react"

import type { RouterOutputs } from "@workspace/api"
import { Decimal } from "@workspace/domain/money"
import type { DataTableColumns } from "@workspace/ui/components/niko-table/types"

import { QUOTE_POLL_MS } from "@/components/quotes/autosave"
import {
  ColumnTitle,
  ListTable,
  ServerPagination,
  ServerTableRoot,
} from "@/components/shell/data-table"
import { PageHeader } from "@/components/shell/page-header"
import { daysSince, formatDate } from "@/lib/format"
import { formatMoney } from "@/lib/money"
import { useTRPC } from "@/trpc/react"

import { AWAITING_PAGE_SIZE } from "./list-input"

type AwaitingRow = RouterOutputs["quote"]["awaitingMyApproval"]["rows"][number]

/** "today", "1 day", "4 days". */
function waited(submittedAt: Date | null) {
  if (!submittedAt) return "—"
  const days = daysSince(submittedAt)
  return days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`
}

const columns: DataTableColumns<AwaitingRow> = [
  {
    id: "name",
    accessorKey: "name",
    header: ColumnTitle,
    meta: { label: "Quote" },
    // One line; the submit comment is the Name's tooltip.
    cell: ({ row }) => (
      <Link
        href={`/quotes/${row.original.id}`}
        title={row.original.submitComment ?? undefined}
        className="block max-w-72 truncate font-medium hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    id: "customer",
    accessorFn: (r) => r.customer.name,
    header: ColumnTitle,
    meta: { label: "Customer" },
  },
  {
    id: "owner",
    accessorFn: (r) => r.owner.name ?? r.owner.email,
    header: ColumnTitle,
    meta: { label: "Owner" },
  },
  {
    id: "dates",
    header: ColumnTitle,
    meta: { label: "Dates" },
    cell: ({ row }) =>
      `${formatDate(row.original.startDate)} – ${formatDate(row.original.endDate)}`,
  },
  {
    id: "total",
    accessorKey: "total",
    header: ColumnTitle,
    meta: { label: "Total", align: "end" },
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {formatMoney(row.original.total, row.original.currencyCode)}
      </div>
    ),
  },
  {
    id: "marginPct",
    accessorKey: "marginPct",
    header: ColumnTitle,
    meta: { label: "Margin %", align: "end" },
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {new Decimal(row.original.marginPct).toFixed(1)}%
      </div>
    ),
  },
  {
    id: "waiting",
    header: ColumnTitle,
    meta: { label: "Waiting" },
    cell: ({ row }) => waited(row.original.submittedAt),
  },
]

/**
 * "Awaiting my approval" (`quote.awaitingMyApproval`): the Quotes In
 * Approval an Approver may decide (never their own), longest-waiting first
 * (the server's order; it pages too). Opening one shows Approve / Reject
 * in its header.
 */
export function AwaitingApprovalList() {
  const trpc = useTRPC()
  const [paging, setPaging] = useState({
    page: 1,
    pageSize: AWAITING_PAGE_SIZE,
  })
  // Suspends (the page prefetches page 1); page changes run in a
  // transition, so the current page stays visible while the next loads.
  const { data, isFetching } = useSuspenseQuery({
    ...trpc.quote.awaitingMyApproval.queryOptions(paging),
    refetchOnWindowFocus: true,
    refetchInterval: QUOTE_POLL_MS,
  })

  return (
    <>
      <PageHeader
        title="Awaiting my approval"
        description="Quotes submitted by others that you can approve or reject."
      />
      <ServerTableRoot
        columns={columns}
        data={data.rows}
        isLoading={false}
        page={paging.page}
        pageSize={paging.pageSize}
        total={data.total}
        onPageChange={(next) => startTransition(() => setPaging(next))}
      >
        <ListTable
          empty={{
            icon: <ClipboardCheckIcon />,
            title: "Nothing awaits your approval",
            description: "Quotes appear here when their Owners submit them.",
          }}
        />
        <ServerPagination total={data.total} isFetching={isFetching} />
      </ServerTableRoot>
    </>
  )
}
