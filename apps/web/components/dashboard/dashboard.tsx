"use client"

import { useSuspenseQuery } from "@tanstack/react-query"

import { OPEN_STATUSES } from "@workspace/domain/dashboard"
import { EXPIRING_SOON_DAYS } from "@workspace/domain/insights"
import { sumDecimals } from "@workspace/domain/money"

import { PageHeader } from "@/components/shell/page-header"
import { useShell } from "@/components/shell/shell-context"
import { wholeMoney } from "@/lib/money"
import { useTRPC } from "@/trpc/react"

import { ActivityCard } from "./activity-card"
import { DashboardCard } from "./dashboard-card"
import {
  ApprovalQueueList,
  ExpiringList,
  LowMarginList,
  RecentList,
  TopAccountsList,
} from "./dashboard-lists"
import { KeyInsights } from "./key-insights"
import { OutcomesCard } from "./outcomes-card"
import { PipelineCard } from "./pipeline-card"

/**
 * The Dashboard, the Organization's landing page: the Key Insights strip,
 * then a bento grid of tiles over `dashboard.overview` — Quotes created per
 * month, the customer win rate, the pipeline by status, the approval
 * queue, low-margin and expiring Quotes, the top Accounts by open value
 * and the caller's recent Quotes. Every tile links into the Quote list
 * (`?insight=` / `?status=`), the approvals page or the record itself.
 */
export function Dashboard() {
  const trpc = useTRPC()
  const { organization } = useShell()
  const { data } = useSuspenseQuery(trpc.dashboard.overview.queryOptions())
  const { data: insights } = useSuspenseQuery(
    trpc.quote.insights.queryOptions()
  )
  const currency = data.currencyCode
  const openRows = data.pipeline.filter((p) =>
    (OPEN_STATUSES as readonly string[]).includes(p.status)
  )
  const open = {
    count: openRows.reduce((n, p) => n + p.count, 0),
    value: sumDecimals(openRows.map((p) => p.value)).toFixed(4),
  }
  const queue = data.approvalQueue

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`What needs attention across ${organization.name}'s Quotes.`}
      >
        <div className="flex items-baseline gap-2 text-sm text-muted-foreground">
          <span className="figure text-2xl font-semibold text-foreground">
            {wholeMoney(open.value, currency)}
          </span>
          open in {open.count} {open.count === 1 ? "Quote" : "Quotes"}
        </div>
      </PageHeader>

      <KeyInsights />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <DashboardCard
          title="Quotes created"
          description="Per month over the last year, by value or count."
          link={{ href: "/quotes?insight=this_month", label: "This month" }}
          className="lg:col-span-8"
        >
          <ActivityCard months={data.months} currencyCode={currency} />
        </DashboardCard>

        <DashboardCard
          title="Win rate"
          description="Customer Approved out of every customer outcome."
          link={{ href: "/quotes?status=customer_approved", label: "Won" }}
          className="lg:col-span-4"
        >
          <OutcomesCard outcomes={data.outcomes} currencyCode={currency} />
        </DashboardCard>

        <DashboardCard
          title="Pipeline by status"
          description="Every Quote's Total, summed per status."
          link={{ href: "/quotes", label: "All Quotes" }}
          className="lg:col-span-12"
        >
          <PipelineCard pipeline={data.pipeline} currencyCode={currency} />
        </DashboardCard>

        <DashboardCard
          title="Approval queue"
          description={
            queue.total === 0
              ? "Pending Approval, longest wait first."
              : data.isApprover
                ? `${queue.waitingForMe} waiting for you · ${queue.total} in all`
                : `${queue.total} Pending Approval, longest wait first`
          }
          link={
            data.isApprover
              ? { href: "/approvals", label: "Review" }
              : { href: "/quotes?insight=pending_approval", label: "View all" }
          }
          className="lg:col-span-4"
        >
          <ApprovalQueueList queue={queue} />
        </DashboardCard>

        <DashboardCard
          title="Low margin"
          description="Open Quotes under 15 %, lowest first."
          link={{ href: "/quotes?insight=low_margin", label: "View all" }}
          className="lg:col-span-4"
        >
          <LowMarginList rows={data.lowMargin} />
        </DashboardCard>

        <DashboardCard
          title="Expiring soon"
          description={`Valid Until in the next ${EXPIRING_SOON_DAYS} days.`}
          link={{ href: "/quotes?insight=expiring_soon", label: "View all" }}
          className="lg:col-span-4"
        >
          <ExpiringList rows={data.expiring} />
        </DashboardCard>

        <DashboardCard
          title="Top Accounts"
          description="By the value of their open Quotes."
          link={{ href: "/accounts", label: "Accounts" }}
          className="lg:col-span-5"
        >
          <TopAccountsList rows={data.topAccounts} currencyCode={currency} />
        </DashboardCard>

        <DashboardCard
          title="Your recent Quotes"
          description="The Quotes you created or changed last."
          link={{ href: "/quotes", label: "All Quotes" }}
          className="lg:col-span-7"
        >
          <RecentList rows={insights.recent} />
        </DashboardCard>
      </div>
    </>
  )
}
