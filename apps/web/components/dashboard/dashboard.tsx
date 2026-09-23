"use client"

import { useSuspenseQuery } from "@tanstack/react-query"

import { Badge } from "@workspace/ui/components/badge"

import { PageHeader } from "@/components/shell/page-header"
import { wholeMoney } from "@/lib/money"
import { useTRPC } from "@/trpc/react"

import { ActivityCard } from "./activity-card"
import { DashboardCard } from "./dashboard-card"
import { ApprovalQueueList, RecentList } from "./dashboard-lists"
import { KeyInsights } from "./key-insights"

/**
 * The Dashboard, the Organization's landing page, kept to a glance: the
 * open pipeline value in the header, the four Key Insights that ask for
 * action, one chart of the value created per month, and two short lists —
 * the approval queue that needs the caller and their recent Quotes. Every
 * cell and list links into the Quote list (`?insight=`), the approvals
 * page or the Quote itself.
 */
export function Dashboard() {
  const trpc = useTRPC()
  const { data } = useSuspenseQuery(trpc.dashboard.overview.queryOptions())
  const { data: insights } = useSuspenseQuery(
    trpc.quote.insights.queryOptions()
  )
  const currency = data.currencyCode
  const { open, approvalQueue: queue, isApprover } = data
  const created = data.months.reduce((n, m) => n + m.count, 0)

  return (
    <>
      <PageHeader title="Dashboard">
        <p className="flex items-baseline gap-2 text-sm text-muted-foreground">
          <span className="figure text-3xl font-semibold text-foreground">
            {wholeMoney(open.value, currency)}
          </span>
          open in {open.count} {open.count === 1 ? "Quote" : "Quotes"}
        </p>
      </PageHeader>

      <KeyInsights />

      <DashboardCard
        title="Value created per month"
        description={`${created} ${created === 1 ? "Quote" : "Quotes"} created in the last 12 months.`}
        link={{ href: "/quotes?insight=this_month", label: "This month" }}
      >
        <ActivityCard months={data.months} currencyCode={currency} />
      </DashboardCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DashboardCard
          title={
            <span className="flex items-center gap-2">
              Needs your attention
              {queue.total > 0 && (
                <Badge variant="secondary" className="tabular-nums">
                  {queue.total}
                  <span className="sr-only">
                    {isApprover
                      ? " waiting for your approval"
                      : " of your Quotes pending approval"}
                  </span>
                </Badge>
              )}
            </span>
          }
          link={
            isApprover
              ? { href: "/approvals", label: "View all" }
              : { href: "/quotes?insight=pending_approval", label: "View all" }
          }
        >
          <ApprovalQueueList queue={queue} isApprover={isApprover} />
        </DashboardCard>

        <DashboardCard
          title="Your recent Quotes"
          link={{ href: "/quotes", label: "View all" }}
        >
          <RecentList rows={insights.recent} />
        </DashboardCard>
      </div>
    </>
  )
}
