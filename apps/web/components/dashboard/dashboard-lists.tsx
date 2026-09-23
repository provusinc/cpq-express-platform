import {
  Building2Icon,
  CalendarCheckIcon,
  ClipboardCheckIcon,
  FileTextIcon,
  ShieldCheckIcon,
} from "lucide-react"
import Link from "next/link"

import type { RouterOutputs } from "@workspace/api"
import { QUOTE_STATUS_LABELS } from "@workspace/domain/enums"
import { Decimal } from "@workspace/domain/money"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item"
import { Progress } from "@workspace/ui/components/progress"
import { cn } from "@workspace/ui/lib/utils"

import { QuoteStatusBadge } from "@/components/quotes/quote-status-badge"
import { formatDate } from "@/lib/format"
import { wholeMoney } from "@/lib/money"

import { TileEmpty } from "./dashboard-card"

type Overview = RouterOutputs["dashboard"]["overview"]
type Recent = RouterOutputs["quote"]["insights"]["recent"]

const days = (n: number) => (n === 1 ? "1 day" : `${n} days`)
const ownerName = (owner: { name: string | null; email: string }) =>
  owner.name ?? owner.email

/** A Quote row: Name over its Account, a figure and a tag at the right. */
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
  figure?: React.ReactNode
  tag?: React.ReactNode
}) {
  return (
    <Item
      size="xs"
      className="-mx-2.5 w-auto flex-nowrap"
      render={<Link href={href} />}
    >
      <ItemContent className="min-w-0">
        <ItemTitle className="block w-full truncate">{name}</ItemTitle>
        <ItemDescription className="truncate">{detail}</ItemDescription>
      </ItemContent>
      <ItemActions className="shrink-0 flex-col items-end gap-0.5">
        {figure && (
          <span className="text-sm font-medium tabular-nums">{figure}</span>
        )}
        {tag}
      </ItemActions>
    </Item>
  )
}

/** How long a Quote has waited, toned by the pending-approval thresholds. */
function WaitTag({ ageDays }: { ageDays: number }) {
  return (
    <span
      className={cn(
        "text-xs tabular-nums",
        ageDays >= 7
          ? "font-medium text-danger-ink"
          : ageDays >= 3
            ? "font-medium text-warning-ink"
            : "text-muted-foreground"
      )}
    >
      {ageDays === 0 ? "today" : `${days(ageDays)} waiting`}
    </span>
  )
}

/**
 * The approval queue, longest wait first. An Approver's rows open the
 * Quote to review (their own Quotes are marked, never reviewable).
 */
export function ApprovalQueueList({
  queue,
}: {
  queue: Overview["approvalQueue"]
}) {
  if (queue.rows.length === 0) {
    return (
      <TileEmpty icon={<ShieldCheckIcon />}>
        Nothing is waiting for approval.
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
            <>
              {q.account.name} · {ownerName(q.owner)}
              {q.mine && " · yours"}
            </>
          }
          figure={wholeMoney(q.total, q.currencyCode)}
          tag={<WaitTag ageDays={q.ageDays} />}
        />
      ))}
    </ItemGroup>
  )
}

/** Undecided Quotes under the margin threshold, lowest margin first. */
export function LowMarginList({ rows }: { rows: Overview["lowMargin"] }) {
  if (rows.length === 0) {
    return (
      <TileEmpty icon={<ClipboardCheckIcon />}>
        Every open Quote clears the margin threshold.
      </TileEmpty>
    )
  }
  return (
    <ItemGroup className="gap-0.5">
      {rows.map((q) => {
        const margin = new Decimal(q.marginPct)
        return (
          <QuoteItem
            key={q.id}
            href={`/quotes/${q.id}`}
            name={q.name}
            detail={q.account.name}
            figure={
              <span
                className={cn(
                  margin.isNegative() ? "text-danger-ink" : "text-warning-ink"
                )}
              >
                {margin.toFixed(1)} %
              </span>
            }
            tag={
              <span className="text-xs text-muted-foreground tabular-nums">
                {wholeMoney(q.total, q.currencyCode)}
              </span>
            }
          />
        )
      })}
    </ItemGroup>
  )
}

/** Offers in play whose Valid Until is close, soonest first. */
export function ExpiringList({ rows }: { rows: Overview["expiring"] }) {
  if (rows.length === 0) {
    return (
      <TileEmpty icon={<CalendarCheckIcon />}>
        No offers lapse in the next two weeks.
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
          detail={
            <>
              {QUOTE_STATUS_LABELS[q.status]} · {formatDate(q.validUntil!)}
            </>
          }
          figure={
            <span className={cn(q.daysLeft <= 3 && "text-warning-ink")}>
              {q.daysLeft === 0 ? "Today" : `in ${days(q.daysLeft)}`}
            </span>
          }
          tag={
            <span className="text-xs text-muted-foreground tabular-nums">
              {wholeMoney(q.total, q.currencyCode)}
            </span>
          }
        />
      ))}
    </ItemGroup>
  )
}

/** The Accounts with the most open value, each with a share-of-top bar. */
export function TopAccountsList({
  rows,
  currencyCode,
}: {
  rows: Overview["topAccounts"]
  currencyCode: string
}) {
  if (rows.length === 0) {
    return (
      <TileEmpty icon={<Building2Icon />}>
        Open Quotes rank their Accounts here.
      </TileEmpty>
    )
  }
  const top = Number(rows[0]!.value) || 1
  return (
    <ItemGroup className="gap-0.5">
      {rows.map((a) => (
        <Item
          key={a.id}
          size="xs"
          className="-mx-2.5 w-auto flex-nowrap"
          render={<Link href={`/accounts/${a.id}`} />}
        >
          <ItemContent className="min-w-0 gap-1.5">
            <div className="flex items-baseline gap-2">
              <ItemTitle className="block min-w-0 flex-1 truncate">
                {a.name}
              </ItemTitle>
              <span className="text-sm font-medium tabular-nums">
                {wholeMoney(a.value, currencyCode)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Progress
                value={Math.max(2, (Number(a.value) / top) * 100)}
                aria-label={`${a.name}'s share of the top Account's value`}
                className="flex-1 **:data-[slot=progress-indicator]:bg-series-1"
              />
              <span className="w-16 text-right text-xs text-muted-foreground tabular-nums">
                {a.count} {a.count === 1 ? "Quote" : "Quotes"}
              </span>
            </div>
          </ItemContent>
        </Item>
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
          detail={q.account.name}
          figure={wholeMoney(q.total, q.currencyCode)}
          tag={<QuoteStatusBadge status={q.status} />}
        />
      ))}
    </ItemGroup>
  )
}
