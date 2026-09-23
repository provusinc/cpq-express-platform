"use client"

import { Bar, BarChart, Cell, LabelList, XAxis, YAxis } from "recharts"

import type { RouterOutputs } from "@workspace/api"
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

import { SERIES } from "@/components/financials/chart-colors"
import { tooltipRow } from "@/components/financials/chart-tooltip"
import { useLabels } from "@/components/shell/labels"
import { formatMoney } from "@/lib/money"

type Breakdown = RouterOutputs["quote"]["summary"]["breakdown"]

/** Each item type keeps its colour (labour, Products, Add-ons). */
const TYPE_COLOR = {
  resource_role: SERIES.one,
  product: SERIES.two,
  add_on: SERIES.three,
} as const

const pct = (value: string) => `${new Decimal(value).toFixed(1)}%`

/**
 * The Summary's item-type breakdown: revenue per type (labour = Resource
 * Roles, Products, Add-ons) before the Quote Discount as a bar chart with
 * its share of the Subtotal, and a table with cost and own margin.
 */
export function ItemTypeBreakdown({
  breakdown,
  currency,
}: {
  breakdown: Breakdown
  currency: string
}) {
  const labels = useLabels()
  const config = Object.fromEntries(
    breakdown.map((row) => [
      row.sourceKind,
      {
        label: labels[row.sourceKind].plural,
        theme: TYPE_COLOR[row.sourceKind],
      },
    ])
  ) satisfies ChartConfig
  const data = breakdown.map((row) => ({
    kind: row.sourceKind,
    fill: `var(--color-${row.sourceKind})`,
    label: labels[row.sourceKind].plural,
    revenue: Number(row.revenue),
    share: pct(row.shareOfSubtotal),
  }))
  const empty = breakdown.every((row) => row.lineCount === 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mix by item type</CardTitle>
        <CardDescription>
          Revenue before the Quote Discount, with each type&apos;s own margin.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {empty ? (
          <p className="text-sm text-muted-foreground">
            Add Line Items to see the mix.
          </p>
        ) : (
          <ChartContainer
            config={config}
            className="aspect-auto h-40 w-full"
            aria-label="Revenue by item type"
          >
            <BarChart
              data={data}
              layout="vertical"
              margin={{ left: 8, right: 56 }}
              barCategoryGap={6}
            >
              <YAxis
                type="category"
                dataKey="label"
                tickLine={false}
                axisLine={false}
                width={110}
              />
              <XAxis type="number" hide />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    hideLabel
                    nameKey="kind"
                    formatter={tooltipRow(
                      config,
                      (v) => formatMoney(String(v), currency),
                      "kind"
                    )}
                  />
                }
              />
              <Bar
                dataKey="revenue"
                radius={4}
                name="revenue"
                isAnimationActive={false}
              >
                {data.map((row) => (
                  <Cell key={row.kind} fill={row.fill} />
                ))}
                <LabelList
                  dataKey="share"
                  position="right"
                  className="fill-muted-foreground"
                  fontSize={12}
                />
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item type</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Margin</TableHead>
              <TableHead className="text-right">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {breakdown.map((row) => (
              <TableRow key={row.sourceKind}>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <span
                      className="size-2.5 rounded-[2px]"
                      style={{
                        backgroundColor: `var(--color-${row.sourceKind}, ${TYPE_COLOR[row.sourceKind].light})`,
                      }}
                      aria-hidden
                    />
                    {labels[row.sourceKind].plural}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.lineCount}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(row.revenue, currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(row.cost, currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {pct(row.marginPct)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {pct(row.shareOfSubtotal)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
