"use client"

import Link from "next/link"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import type { RouterOutputs } from "@workspace/api"
import { QUOTE_STATUS_LABELS } from "@workspace/domain/enums"
import {
  type ChartConfig,
  ChartContainer,
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
import { cn } from "@workspace/ui/lib/utils"

import { SERIES } from "@/components/financials/chart-colors"
import { tooltipRow } from "@/components/financials/chart-tooltip"
import { STATUS_SOLID } from "@/components/quotes/quote-status-badge"
import { compactMoney, formatMoney, wholeMoney } from "@/lib/money"

type Pipeline = RouterOutputs["dashboard"]["overview"]["pipeline"]

const config = {
  value: { label: "Value", theme: SERIES.one },
} satisfies ChartConfig

/**
 * The Organization's Quotes by status: summed Total per status as one
 * series of horizontal bars (magnitude, one colour), and beside it the
 * same numbers with each status's count. A row opens the Quote list
 * filtered to that status (`?status=…`).
 */
export function PipelineCard({
  pipeline,
  currencyCode,
}: {
  pipeline: Pipeline
  currencyCode: string
}) {
  const rows = pipeline.map((p) => ({
    status: p.status,
    label: QUOTE_STATUS_LABELS[p.status],
    value: Number(p.value),
  }))

  return (
    <div className="grid min-h-0 flex-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <ChartContainer
        config={config}
        className="aspect-auto h-64 w-full"
        aria-label="Quote value by status"
      >
        <BarChart
          data={rows}
          layout="vertical"
          accessibilityLayer
          margin={{ left: 0, right: 12 }}
        >
          <CartesianGrid horizontal={false} />
          <XAxis
            type="number"
            tickLine={false}
            axisLine={false}
            tickMargin={6}
            tickFormatter={(v: number) => compactMoney(v, currencyCode)}
          />
          <YAxis
            type="category"
            dataKey="label"
            tickLine={false}
            axisLine={false}
            width={148}
            tick={{ fontSize: 12 }}
          />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", opacity: 0.6 }}
            content={
              <ChartTooltipContent
                formatter={tooltipRow(config, (v) =>
                  formatMoney(String(v), currencyCode)
                )}
              />
            }
          />
          <Bar
            isAnimationActive={false}
            dataKey="value"
            fill="var(--color-value)"
            maxBarSize={18}
            radius={[0, 4, 4, 0]}
          />
        </BarChart>
      </ChartContainer>
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead className="h-8">Status</TableHead>
            <TableHead className="h-8 text-right">Quotes</TableHead>
            <TableHead className="h-8 text-right">Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pipeline.map((p) => (
            <TableRow key={p.status} className="group/row relative">
              <TableCell className="py-1.5">
                <Link
                  href={`/quotes?status=${p.status}`}
                  className="flex items-center gap-2 outline-none after:absolute after:inset-0 focus-visible:underline"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      STATUS_SOLID[p.status]
                    )}
                  />
                  <span className="truncate">
                    {QUOTE_STATUS_LABELS[p.status]}
                  </span>
                </Link>
              </TableCell>
              <TableCell
                className={cn(
                  "py-1.5 text-right font-medium",
                  p.count === 0 && "text-muted-foreground"
                )}
              >
                {p.count}
              </TableCell>
              <TableCell
                className={cn(
                  "py-1.5 text-right",
                  p.count === 0 && "text-muted-foreground"
                )}
              >
                {wholeMoney(p.value, currencyCode)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
