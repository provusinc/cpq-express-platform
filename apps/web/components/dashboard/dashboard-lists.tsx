import { FileTextIcon, ShieldCheckIcon } from "lucide-react"
import Link from "next/link"

import type { RouterOutputs } from "@workspace/api"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item"
import { cn } from "@workspace/ui/lib/utils"

import { QuoteStatusBadge } from "@/components/quotes/quote-status-badge"
import { wholeMoney } from "@/lib/money"

import { TileEmpty } from "./dashboard-card"

type Queue = RouterOutputs["dashboard"]["overview"]["approvalQueue"]
type Recent = RouterOutputs["quote"]["insights"]["recent"]

const days = (n: number) => (n === 1 ? "1 day" : `${n} days`)
const ownerName = (owner: { name: string | null; email: string }) =>
  owner.name ?? owner.email

/** A Quote row: Name over a detail line, a tag and a figure at the right. */
function QuoteItem({
  href,
  name,
  detail,
  figure,
  tag,
}: {
  href: string
  name: string
  detail: React.ReactNode
  figure: React.ReactNode
  tag: React.ReactNode
}) {
  return (
    <Item
      size="xs"
      className="-mx-2.5 w-auto flex-nowrap py-1"
      render={<Link href={href} />}
    >
      <ItemContent className="min-w-0">
        <ItemTitle className="block w-full truncate">{name}</ItemTitle>
        <ItemDescription className="truncate">{detail}</ItemDescription>
      </ItemContent>
      <ItemActions className="shrink-0 gap-3">
        {tag}
        <span className="min-w-20 text-right text-sm font-medium tabular-nums">
          {figure}
        </span>
      </ItemActions>
    </Item>
  )
}

/** How long a Quote has waited; only a week or more is toned. */
function WaitTag({ ageDays }: { ageDays: number }) {
  return (
    <span
      className={cn(
        "text-xs tabular-nums",
        ageDays >= 7 ? "text-warning-ink" : "text-muted-foreground"
      )}
    >
      {ageDays === 0 ? "since today" : `${days(ageDays)} waiting`}
    </span>
  )
}

/**
 * "Needs your attention": the approval queue, longest wait first — for an
 * Approver the Quotes waiting for them, for anyone else their own Quotes
 * pending approval.
 */
export function ApprovalQueueList({
  queue,
  isApprover,
}: {
  queue: Queue
  isApprover: boolean
}) {
  if (queue.rows.length === 0) {
    return (
      <TileEmpty icon={<ShieldCheckIcon />}>
        {isApprover
          ? "Nothing is waiting for your approval."
          : "None of your Quotes is waiting for approval."}
      </TileEmpty>
    )
  }
  return (
    <ItemGroup className="gap-0.5">
      {queue.rows.map((q) => (
        <QuoteItem
          key={q.id}
          href={`/quotes/${q.id}`}
          name={q.name}
          detail={
            isApprover
              ? `${q.customer.name} · ${ownerName(q.owner)}`
              : q.customer.name
          }
          figure={wholeMoney(q.total, q.currencyCode)}
          tag={<WaitTag ageDays={q.ageDays} />}
        />
      ))}
    </ItemGroup>
  )
}

/** The caller's recently changed Quotes (from `quote.insights`). */
export function RecentList({ rows }: { rows: Recent }) {
  if (rows.length === 0) {
    return (
      <TileEmpty icon={<FileTextIcon />}>
        Quotes you create or change appear here.
      </TileEmpty>
    )
  }
  return (
    <ItemGroup className="gap-0.5">
      {rows.map((q) => (
        <QuoteItem
          key={q.id}
          href={`/quotes/${q.id}`}
          name={q.name}
          detail={q.customer.name}
          figure={wholeMoney(q.total, q.currencyCode)}
          tag={
            <QuoteStatusBadge
              stage={q.stage}
              status={q.status}
              rejected={q.rejected}
            />
          }
        />
      ))}
    </ItemGroup>
  )
}
