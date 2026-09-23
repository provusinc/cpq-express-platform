"use client"

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import type { RouterOutputs } from "@workspace/api"
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@workspace/ui/components/chart"

import { SERIES } from "@/components/financials/chart-colors"
import { tooltipRow } from "@/components/financials/chart-tooltip"
import { compactMoney, formatMoney, wholeMoney } from "@/lib/money"

type Month = RouterOutputs["dashboard"]["overview"]["months"][number]

const config = {
  value: { label: "Value created", theme: SERIES.one },
} satisfies ChartConfig

/** "2026-09-01" → "Sep" (the tooltip carries the year). */
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
 * The value of the Quotes created per month over the last twelve (UTC):
 * a glance, so one measure and no table beside it. Screen readers get the
 * months as a list.
 */
export function ActivityCard({
  months,
  currencyCode,
}: {
  months: Month[]
  currencyCode: string
}) {
  const rows = months.map((m) => ({ month: m.month, value: Number(m.value) }))

  return (
    <>
      <ChartContainer
        config={config}
        className="aspect-auto h-36 w-full"
        aria-hidden
      >
        <BarChart data={rows} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
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
            width={52}
            tickCount={4}
            tickFormatter={(v: number) => compactMoney(v, currencyCode)}
          />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", opacity: 0.6 }}
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) =>
                  monthLabel(String(payload?.[0]?.payload?.month ?? ""))
                }
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
            maxBarSize={28}
            radius={[3, 3, 0, 0]}
          />
        </BarChart>
      </ChartContainer>
      <ul className="sr-only" aria-label="Value of Quotes created per month">
        {months.map((m) => (
          <li key={m.month}>
            {monthLabel(m.month)}: {wholeMoney(m.value, currencyCode)} in{" "}
            {m.count} {m.count === 1 ? "Quote" : "Quotes"}
          </li>
        ))}
      </ul>
    </>
  )
}
