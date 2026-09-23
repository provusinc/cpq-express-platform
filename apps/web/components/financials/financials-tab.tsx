"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from "recharts"

import type { FinancialGranularity } from "@workspace/domain/financials"
import { Decimal } from "@workspace/domain/money"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@workspace/ui/components/chart"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"

import { QUOTE_POLL_MS } from "@/components/quotes/autosave"
import { useLabels } from "@/components/shell/labels"
import { compactMoney, formatMoney } from "@/lib/money"
import { useTRPC } from "@/trpc/react"

import { SERIES } from "./chart-colors"
import { tooltipRow } from "./chart-tooltip"

const GRANULARITIES: { value: FinancialGranularity; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
]

const VIEWS = [
  { value: "cash", label: "Cash inflow" },
  { value: "cost", label: "Cost" },
  { value: "utilization", label: "Utilization" },
  { value: "combined", label: "Combined" },
] as const
type View = (typeof VIEWS)[number]["value"]

const config = {
  revenue: { label: "Cash inflow", theme: SERIES.one },
  cost: { label: "Cost", theme: SERIES.two },
  margin: { label: "Margin", theme: SERIES.three },
  headcount: { label: "Headcount (FTE)", theme: SERIES.three },
} satisfies ChartConfig

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card p-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="figure text-2xl leading-tight font-semibold">
        {value}
      </span>
    </div>
  )
}

/**
 * The Quote editor's Financials tab (`quote.financials`): cash inflow
 * (revenue after the Quote Discount), cost, utilization (headcount in
 * full-time equivalents) and a combined revenue / cost / margin view, by
 * month, quarter or year, prorated by calendar-day overlap (see the
 * domain's `financials` area). Money shares one axis; headcount has its
 * own chart, never a second axis. A table repeats every number.
 */
export function FinancialsTab({ quoteId }: { quoteId: string }) {
  const trpc = useTRPC()
  const labels = useLabels()
  const data = useSuspenseQuery({
    ...trpc.quote.financials.queryOptions({ id: quoteId }),
    refetchOnWindowFocus: true,
    refetchInterval: QUOTE_POLL_MS,
  }).data
  const [granularity, setGranularity] = useState<FinancialGranularity>("month")
  const [view, setView] = useState<View>("cash")
  const currency = data.currencyCode
  const money = (amount: string) => formatMoney(amount, currency)
  const { buckets, totals } = data[granularity]
  const rows = buckets.map((b) => ({
    label: b.label,
    revenue: Number(b.revenue),
    cost: Number(b.cost),
    margin: Number(b.margin),
    headcount: Number(b.headcount),
  }))
  const moneyTooltip = tooltipRow(config, (v) =>
    formatMoney(String(v), currency)
  )
  const hasLines =
    !new Decimal(totals.grossRevenue).isZero() ||
    !new Decimal(totals.cost).isZero() ||
    !new Decimal(totals.hours).isZero()

  const axes = (
    <>
      <CartesianGrid vertical={false} />
      <XAxis
        dataKey="label"
        tickLine={false}
        axisLine={false}
        tickMargin={8}
        minTickGap={12}
      />
    </>
  )
  const moneyAxis = (
    <YAxis
      tickLine={false}
      axisLine={false}
      width={64}
      tickFormatter={(v: number) => compactMoney(v, currency)}
    />
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList>
            {VIEWS.map((v) => (
              <TabsTrigger key={v.value} value={v.value}>
                {v.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Tabs
          value={granularity}
          onValueChange={(v) => setGranularity(v as FinancialGranularity)}
        >
          <TabsList aria-label="Granularity">
            {GRANULARITIES.map((g) => (
              <TabsTrigger key={g.value} value={g.value}>
                {g.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Cash inflow" value={money(totals.revenue)} />
        <Stat label="Cost" value={money(totals.cost)} />
        <Stat label="Margin" value={money(totals.margin)} />
        <Stat
          label="Peak headcount"
          value={`${new Decimal(totals.peakHeadcount).toFixed(1)} FTE`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{VIEWS.find((v) => v.value === view)!.label}</CardTitle>
          <CardDescription>
            {view === "cash" &&
              "Revenue after the Quote Discount (spread in proportion to revenue), prorated by calendar days."}
            {view === "cost" &&
              "Unit cost × quantity, prorated by calendar days."}
            {view === "utilization" &&
              `${labels.resource_role.singular} hours as full-time equivalents at ${data.hoursPerDay} hours a working day (${new Decimal(totals.hours).toFixed(0)} hours in all).`}
            {view === "combined" &&
              "Cash inflow and cost side by side, with the margin between them."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!hasLines ? (
            <p className="text-sm text-muted-foreground">
              Add Line Items to see the Quote&apos;s profile over time.
            </p>
          ) : (
            <ChartContainer
              config={config}
              className="aspect-auto h-72 w-full"
              aria-label={`${VIEWS.find((v) => v.value === view)!.label} by ${granularity}`}
            >
              {view === "utilization" ? (
                <BarChart data={rows} accessibilityLayer>
                  {axes}
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    allowDecimals
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={tooltipRow(
                          config,
                          (v) => `${v.toFixed(2)} FTE`
                        )}
                      />
                    }
                  />
                  <Bar
                    isAnimationActive={false}
                    maxBarSize={56}
                    dataKey="headcount"
                    fill="var(--color-headcount)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              ) : view === "combined" ? (
                <ComposedChart data={rows} accessibilityLayer barGap={2}>
                  {axes}
                  {moneyAxis}
                  <ChartTooltip
                    content={<ChartTooltipContent formatter={moneyTooltip} />}
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar
                    isAnimationActive={false}
                    maxBarSize={56}
                    dataKey="revenue"
                    fill="var(--color-revenue)"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    isAnimationActive={false}
                    maxBarSize={56}
                    dataKey="cost"
                    fill="var(--color-cost)"
                    radius={[4, 4, 0, 0]}
                  />
                  <Line
                    isAnimationActive={false}
                    dataKey="margin"
                    type="monotone"
                    stroke="var(--color-margin)"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                  />
                </ComposedChart>
              ) : (
                <BarChart data={rows} accessibilityLayer>
                  {axes}
                  {moneyAxis}
                  <ChartTooltip
                    content={<ChartTooltipContent formatter={moneyTooltip} />}
                  />
                  <Bar
                    isAnimationActive={false}
                    maxBarSize={56}
                    dataKey={view === "cash" ? "revenue" : "cost"}
                    fill={
                      view === "cash"
                        ? "var(--color-revenue)"
                        : "var(--color-cost)"
                    }
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              )}
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>By {granularity}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Discount</TableHead>
                <TableHead className="text-right">Cash inflow</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead className="text-right">Headcount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {buckets.map((b) => (
                <TableRow key={b.periodStart}>
                  <TableCell className="font-medium">{b.label}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(b.grossRevenue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {new Decimal(b.discount).isZero()
                      ? "—"
                      : `−${money(b.discount)}`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(b.revenue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(b.cost)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(b.margin)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {new Decimal(b.hours).toFixed(1)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {new Decimal(b.headcount).toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-medium">
                <TableCell>Total</TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(totals.grossRevenue)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {new Decimal(totals.discount).isZero()
                    ? "—"
                    : `−${money(totals.discount)}`}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(totals.revenue)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(totals.cost)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(totals.margin)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {new Decimal(totals.hours).toFixed(1)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
