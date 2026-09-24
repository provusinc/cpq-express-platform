"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { ChartColumnIcon, TableIcon } from "lucide-react"
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
import { Card, CardContent, CardHeader } from "@workspace/ui/components/card"
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
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"

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

type Mode = "chart" | "table"

/**
 * The Quote editor's Financials tab (`quote.financials`): cash inflow
 * (revenue after the Quote Discount), cost, utilization (headcount in
 * full-time equivalents) and a combined revenue / cost / margin view, by
 * month, quarter or year, prorated by calendar-day overlap (see the
 * domain's `financials` area). One card: the view tabs, the granularity
 * and a Chart | Table toggle in its header; the table replaces the chart
 * in place with the same numbers. Money shares one axis; headcount has its
 * own chart, never a second axis. The Quote's totals are in the header,
 * so there are no stat tiles (only the peak headcount, on Utilization).
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
  const [mode, setMode] = useState<Mode>("chart")
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
  const discount = (amount: string) =>
    new Decimal(amount).isZero() ? "—" : `−${money(amount)}`
  const hours = (amount: string) =>
    Number(new Decimal(amount).toFixed(1)).toLocaleString("en", {
      minimumFractionDigits: 1,
    })
  /** The table's columns per view: the numbers its chart draws. */
  const columns: Record<
    View,
    {
      label: string
      bucket: (b: (typeof buckets)[number]) => string
      total: (t: typeof totals) => string
    }[]
  > = {
    cash: [
      {
        label: "Revenue",
        bucket: (b) => money(b.grossRevenue),
        total: (t) => money(t.grossRevenue),
      },
      {
        label: "Discount",
        bucket: (b) => discount(b.discount),
        total: (t) => discount(t.discount),
      },
      {
        label: "Cash inflow",
        bucket: (b) => money(b.revenue),
        total: (t) => money(t.revenue),
      },
    ],
    cost: [
      {
        label: "Hours",
        bucket: (b) => hours(b.hours),
        total: (t) => hours(t.hours),
      },
      {
        label: "Cost",
        bucket: (b) => money(b.cost),
        total: (t) => money(t.cost),
      },
    ],
    utilization: [
      {
        label: "Hours",
        bucket: (b) => hours(b.hours),
        total: (t) => hours(t.hours),
      },
      {
        label: "Headcount (FTE)",
        bucket: (b) => new Decimal(b.headcount).toFixed(2),
        total: () => "",
      },
    ],
    combined: [
      {
        label: "Cash inflow",
        bucket: (b) => money(b.revenue),
        total: (t) => money(t.revenue),
      },
      {
        label: "Cost",
        bucket: (b) => money(b.cost),
        total: (t) => money(t.cost),
      },
      {
        label: "Margin",
        bucket: (b) => money(b.margin),
        total: (t) => money(t.margin),
      },
    ],
  }
  const viewLabel = VIEWS.find((v) => v.value === view)!.label
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
    <Card className="gap-0 pt-0">
      <CardHeader className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b py-2 [.border-b]:pb-2">
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList variant="line" aria-label="View" className="h-9">
            {VIEWS.map((v) => (
              <TabsTrigger key={v.value} value={v.value} className="px-2.5">
                {v.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ToggleGroup
            multiple={false}
            value={[granularity]}
            onValueChange={(value) =>
              value[0] && setGranularity(value[0] as FinancialGranularity)
            }
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Granularity"
          >
            {GRANULARITIES.map((g) => (
              <ToggleGroupItem key={g.value} value={g.value} className="px-3">
                {g.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ToggleGroup
            multiple={false}
            value={[mode]}
            onValueChange={(value) => value[0] && setMode(value[0] as Mode)}
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Show as"
          >
            <ToggleGroupItem value="chart" className="px-2.5">
              <ChartColumnIcon data-icon="inline-start" />
              Chart
            </ToggleGroupItem>
            <ToggleGroupItem value="table" className="px-2.5">
              <TableIcon data-icon="inline-start" />
              Table
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <p className="text-sm text-muted-foreground">
            {view === "cash" &&
              "Revenue after the Quote Discount (spread in proportion to revenue), prorated by calendar days."}
            {view === "cost" &&
              "Unit cost × quantity, prorated by calendar days."}
            {view === "utilization" &&
              `${labels.resource_role.singular} hours as full-time equivalents at ${data.hoursPerDay} hours a working day (${new Decimal(totals.hours).toFixed(0)} hours in all).`}
            {view === "combined" &&
              "Cash inflow and cost side by side, with the margin between them."}
          </p>
          {view === "utilization" && hasLines && (
            <p className="flex items-baseline gap-1.5 text-sm whitespace-nowrap">
              <span className="text-xs text-muted-foreground">
                Peak headcount
              </span>
              <span className="figure text-base font-semibold">
                {new Decimal(totals.peakHeadcount).toFixed(1)}
              </span>
              <span className="text-xs text-muted-foreground">FTE</span>
            </p>
          )}
        </div>
        {!hasLines ? (
          <p className="text-sm text-muted-foreground">
            Add Line Items to see the Quote&apos;s profile over time.
          </p>
        ) : mode === "table" ? (
          <Table aria-label={`${viewLabel} by ${granularity}`}>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                {columns[view].map((c) => (
                  <TableHead key={c.label} className="w-40 text-right">
                    {c.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {buckets.map((b) => (
                <TableRow key={b.periodStart}>
                  <TableCell className="font-medium">{b.label}</TableCell>
                  {columns[view].map((c) => (
                    <TableCell key={c.label} className="text-right">
                      {c.bucket(b)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              <TableRow className="font-medium">
                <TableCell>Total</TableCell>
                {columns[view].map((c) => (
                  <TableCell key={c.label} className="text-right">
                    {c.total(totals)}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        ) : (
          <ChartContainer
            config={config}
            className="aspect-auto h-80 w-full"
            aria-label={`${viewLabel} by ${granularity}`}
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
  )
}
