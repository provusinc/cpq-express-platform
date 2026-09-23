"use client"

import { useState } from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import type { RouterOutputs } from "@workspace/api"
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@workspace/ui/components/chart"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"

import { SERIES } from "@/components/financials/chart-colors"
import { tooltipRow } from "@/components/financials/chart-tooltip"
import { compactMoney, formatMoney, wholeMoney } from "@/lib/money"

type Month = RouterOutputs["dashboard"]["overview"]["months"][number]

const MEASURES = [
  { value: "value", label: "Value" },
  { value: "count", label: "Quotes" },
] as const
type Measure = (typeof MEASURES)[number]["value"]

const config = {
  value: { label: "Value created", theme: SERIES.one },
  count: { label: "Quotes created", theme: SERIES.one },
} satisfies ChartConfig

/** "2026-09-01" → "Sep" (the table and tooltip carry the year). */
const monthTick = (month: string) =>
  new Date(`${month}T00:00:00.000Z`).toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  })

/** "2026-09-01" → "Sep 2026". */
const monthLabel = (month: string) =>
  new Date(`${month}T00:00:00.000Z`).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })

/**
 * Quotes created per month over the last twelve (UTC), as their summed
 * Total or their count (one measure at a time, one axis), with the same
 * numbers in a table beside the chart.
 */
export function ActivityCard({
  months,
  currencyCode,
}: {
  months: Month[]
  currencyCode: string
}) {
  const [measure, setMeasure] = useState<Measure>("value")
  const rows = months.map((m) => ({
    month: m.month,
    value: Number(m.value),
    count: m.count,
  }))
  const totalCount = months.reduce((n, m) => n + m.count, 0)
  const format = (v: number) =>
    measure === "value" ? formatMoney(String(v), currencyCode) : String(v)

  return (
    <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_15rem]">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            <span className="figure text-2xl font-semibold text-foreground">
              {totalCount}
            </span>{" "}
            Quotes in 12 months
          </p>
          <ToggleGroup
            aria-label="Measure"
            value={[measure]}
            onValueChange={(values) => {
              const next = values[0] as Measure | undefined
              if (next) setMeasure(next)
            }}
            variant="outline"
            size="sm"
            spacing={0}
          >
            {MEASURES.map((m) => (
              <ToggleGroupItem key={m.value} value={m.value}>
                {m.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <ChartContainer
          config={config}
          className="aspect-auto h-56 w-full"
          aria-label={`Quotes created per month, ${measure === "value" ? "value" : "count"}`}
        >
          <BarChart data={rows} accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              interval={0}
              tickFormatter={monthTick}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={measure === "value" ? 56 : 28}
              allowDecimals={false}
              tickFormatter={(v: number) =>
                measure === "value" ? compactMoney(v, currencyCode) : String(v)
              }
            />
            <ChartTooltip
              cursor={{ fill: "var(--muted)", opacity: 0.6 }}
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) =>
                    monthLabel(String(payload?.[0]?.payload?.month ?? ""))
                  }
                  formatter={tooltipRow(config, format)}
                />
              }
            />
            <Bar
              isAnimationActive={false}
              dataKey={measure}
              fill={`var(--color-${measure})`}
              maxBarSize={24}
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
      </div>
      <ScrollArea className="h-64 rounded-lg border xl:h-auto xl:max-h-72">
        <Table className="text-xs">
          <TableHeader className="sticky top-0 bg-card">
            <TableRow>
              <TableHead className="h-8">Month</TableHead>
              <TableHead className="h-8 text-right">Quotes</TableHead>
              <TableHead className="h-8 text-right">Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...months].reverse().map((m) => (
              <TableRow key={m.month}>
                <TableCell className="py-1.5">{monthLabel(m.month)}</TableCell>
                <TableCell className="py-1.5 text-right">{m.count}</TableCell>
                <TableCell className="py-1.5 text-right">
                  {wholeMoney(m.value, currencyCode)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  )
}
