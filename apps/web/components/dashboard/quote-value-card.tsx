"use client"

import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { ChartAreaIcon } from "lucide-react"
import { useState } from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import type { RouterOutputs } from "@workspace/api"
import {
  DEFAULT_VALUE_RANGE,
  VALUE_RANGE_SPECS,
  VALUE_RANGES,
  type ValueRange,
} from "@workspace/domain/dashboard"
import {
  Card,
  CardAction,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"
import { cn } from "@workspace/ui/lib/utils"

import { tooltipRow } from "@/components/financials/chart-tooltip"
import { compactMoney, wholeMoney } from "@/lib/money"
import { useTRPC } from "@/trpc/react"

import { TileEmpty } from "./dashboard-card"

type ValueOverTime = RouterOutputs["dashboard"]["valueOverTime"]
type Unit = ValueOverTime["unit"]

/** Both series are money, so they share the one value axis. */
const config = {
  created: { label: "Created", color: "var(--series-1)" },
  won: { label: "Won", color: "var(--series-2)" },
} satisfies ChartConfig

const SERIES_KEYS = ["created", "won"] as const

const RANGE_ITEMS = VALUE_RANGES.map((value) => ({
  value,
  label: VALUE_RANGE_SPECS[value].label,
}))

const utc = (day: string) => new Date(`${day}T00:00:00.000Z`)

/** "2026-09-21" → "Sep 21". */
const dayTick = (day: string) =>
  utc(day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })

/** A bucket's name: "Week of Sep 21, 2026" or "Wed, Sep 23, 2026". */
function bucketLabel(day: string, unit: Unit) {
  const date = utc(day).toLocaleDateString("en-US", {
    ...(unit === "day" ? { weekday: "short" } : {}),
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
  return unit === "week" ? `Week of ${date}` : date
}

const quotes = (n: number) => `${n} ${n === 1 ? "Quote" : "Quotes"}`

/**
 * The Dashboard's one chart, after shadcn's `chart-area-interactive`
 * block: the value of the Quotes created and of those Won, per day or week of the chosen range, as two
 * overlaid areas on one money axis (not stacked: they're different
 * Quotes on different dates). The range toggle sits at the card's top
 * right (a Select when the card is narrow); the previous range stays
 * drawn while the next loads. The chart is `aria-hidden`; screen readers
 * get the buckets as a list.
 */
export function QuoteValueCard({ currencyCode }: { currencyCode: string }) {
  const trpc = useTRPC()
  const [range, setRange] = useState<ValueRange>(DEFAULT_VALUE_RANGE)
  const { data, isPlaceholderData } = useQuery({
    ...trpc.dashboard.valueOverTime.queryOptions({ range }),
    placeholderData: keepPreviousData,
  })
  const label = VALUE_RANGE_SPECS[range].label
  const unit = data?.unit ?? VALUE_RANGE_SPECS[range].unit
  const rows = (data?.buckets ?? []).map((b) => ({
    start: b.start,
    created: Number(b.created.value),
    won: Number(b.won.value),
  }))
  const empty =
    data !== undefined &&
    !isPlaceholderData &&
    data.buckets.every((b) => b.created.count === 0 && b.won.count === 0)
  const select = (next: unknown) => {
    if (VALUE_RANGES.includes(next as ValueRange)) setRange(next as ValueRange)
  }

  return (
    <Card className="@container/card min-w-0 gap-3">
      <CardHeader>
        <CardTitle className="text-sm">Quote value</CardTitle>
        <CardDescription className="text-xs">
          <span className="hidden @[540px]/card:block">
            Total for the {label.toLowerCase()}
          </span>
          <span className="@[540px]/card:hidden">{label}</span>
        </CardDescription>
        <CardAction>
          <ToggleGroup
            multiple={false}
            value={[range]}
            onValueChange={(value) => select(value[0])}
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Time range"
            className="hidden @[767px]/card:flex"
          >
            {RANGE_ITEMS.map((item) => (
              <ToggleGroupItem
                key={item.value}
                value={item.value}
                className="px-3"
              >
                {item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Select items={RANGE_ITEMS} value={range} onValueChange={select}>
            <SelectTrigger
              size="sm"
              aria-label="Time range"
              className="flex w-36 @[767px]/card:hidden"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        {empty ? (
          <div className="flex h-40 flex-col">
            <TileEmpty icon={<ChartAreaIcon />}>
              No Quotes created or Won in the {label.toLowerCase()}.
            </TileEmpty>
          </div>
        ) : (
          <>
            <ChartContainer
              config={config}
              className={cn(
                "aspect-auto h-40 w-full transition-opacity",
                isPlaceholderData && "opacity-60"
              )}
              aria-hidden
            >
              <AreaChart
                data={rows}
                margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
              >
                <defs>
                  {SERIES_KEYS.map((key) => (
                    <linearGradient
                      key={key}
                      id={`fill-${key}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor={`var(--color-${key})`}
                        stopOpacity={0.3}
                      />
                      <stop
                        offset="95%"
                        stopColor={`var(--color-${key})`}
                        stopOpacity={0.02}
                      />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="2 4" />
                <XAxis
                  dataKey="start"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={32}
                  tickFormatter={dayTick}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tickCount={4}
                  tickFormatter={(v: number) => compactMoney(v, currencyCode)}
                />
                <ChartTooltip
                  cursor={{ stroke: "var(--border)" }}
                  content={
                    <ChartTooltipContent
                      indicator="dot"
                      className="min-w-48"
                      labelFormatter={(_, payload) =>
                        bucketLabel(
                          String(payload?.[0]?.payload?.start ?? ""),
                          unit
                        )
                      }
                      formatter={tooltipRow(config, (v) =>
                        compactMoney(v, currencyCode)
                      )}
                    />
                  }
                />
                {SERIES_KEYS.map((key) => (
                  <Area
                    key={key}
                    dataKey={key}
                    type="monotone"
                    isAnimationActive={false}
                    fill={`url(#fill-${key})`}
                    stroke={`var(--color-${key})`}
                    strokeWidth={1.5}
                    activeDot={{
                      r: 4,
                      strokeWidth: 2,
                      stroke: "var(--card)",
                    }}
                  />
                ))}
                {/* In series order, not alphabetical (Recharts' default). */}
                <ChartLegend
                  itemSorter={null}
                  content={<ChartLegendContent />}
                />
              </AreaChart>
            </ChartContainer>
            {data && (
              <ul className="sr-only" aria-label={`Quote value, ${label}`}>
                {data.buckets.map((b) => (
                  <li key={b.start}>
                    {bucketLabel(b.start, data.unit)}:{" "}
                    {wholeMoney(b.created.value, currencyCode)} created in{" "}
                    {quotes(b.created.count)},{" "}
                    {wholeMoney(b.won.value, currencyCode)} Won in{" "}
                    {quotes(b.won.count)}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
