"use client"

import { breakdownByItemType } from "@workspace/domain/financials"
import { Decimal } from "@workspace/domain/money"
import { cn } from "@workspace/ui/lib/utils"

import type { EditorLine, EditorTotals } from "@/components/quotes/autosave"
import { useCatalogTypes } from "@/components/shell/catalog-types"
import { useLabels } from "@/components/shell/labels"
import { catalogTypeTone, LABOUR_TONE } from "@/components/shell/tints"
import { wholeMoney } from "@/lib/money"

import { OverviewCard } from "./overview-card"

const pct = (value: string | Decimal) => `${new Decimal(value).toFixed(0)}%`

/**
 * What the Quote is made of: revenue per item type (labour = Resource
 * Roles, then each Catalog Type) before the Quote Discount as one proportion
 * bar, a legend with each type's share and own margin, and the blended
 * hourly rate and cost of the labour. Computed in the browser from the
 * editor's lines (the domain's `breakdownByItemType`), so it follows
 * edits at once.
 */
export function MixCard({
  lines,
  totals,
  className,
}: {
  lines: readonly EditorLine[]
  totals: EditorTotals
  className?: string
}) {
  const labels = useLabels()
  const types = useCatalogTypes()
  const currency = totals.currencyCode
  const typeById = new Map(types.map((t) => [t.id, t]))
  // Labour and every active type are listed; an inactive one only when used.
  const breakdown = breakdownByItemType(
    lines,
    types.map((t) => t.id)
  )
    .filter(
      (row) =>
        row.lineCount > 0 ||
        !row.catalogTypeId ||
        typeById.get(row.catalogTypeId)?.active
    )
    .map((row) => {
      const type = row.catalogTypeId
        ? typeById.get(row.catalogTypeId)
        : undefined
      return {
        ...row,
        name: row.catalogTypeId
          ? (type?.plural ?? "Catalog Items")
          : labels.resource_role.plural,
        dot: row.catalogTypeId
          ? catalogTypeTone(type?.colourIndex ?? 0).dot
          : LABOUR_TONE.dot,
      }
    })
  const empty = breakdown.every((row) => row.lineCount === 0)

  const labour = lines.filter((l) => l.sourceKind === "resource_role")
  const hours = labour.reduce((s, l) => s.plus(l.quantity), new Decimal(0))
  const revenue = labour.reduce((s, l) => s.plus(l.lineTotal), new Decimal(0))
  const cost = labour.reduce(
    (s, l) => s.plus(new Decimal(l.unitCost).times(l.quantity)),
    new Decimal(0)
  )
  const perHour = (amount: Decimal) =>
    hours.isZero() ? "—" : wholeMoney(amount.div(hours).toFixed(4), currency)

  return (
    <OverviewCard
      title="Mix"
      description="Share of the Subtotal before the Quote Discount"
      className={className}
    >
      {empty ? (
        <p className="flex flex-1 items-center justify-center py-6 text-sm text-muted-foreground">
          Add Line Items to see the mix.
        </p>
      ) : (
        <>
          <div
            className="flex h-2.5 gap-0.5 overflow-hidden rounded-full"
            aria-hidden
          >
            {breakdown
              .filter((row) => new Decimal(row.shareOfSubtotal).gt(0))
              .map((row) => (
                <span
                  key={row.key}
                  className={cn("h-full", row.dot)}
                  style={{ width: `${row.shareOfSubtotal}%` }}
                />
              ))}
          </div>
          <table className="mt-3 w-full text-sm">
            <caption className="sr-only">Revenue by item type</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Item type</th>
                <th scope="col">Revenue</th>
                <th scope="col">Share</th>
                <th scope="col">Own margin</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((row) => (
                <tr key={row.key} className="h-8">
                  <th scope="row" className="text-left font-normal">
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "size-2.5 shrink-0 rounded-[3px]",
                          row.dot
                        )}
                        aria-hidden
                      />
                      {row.name}
                    </span>
                  </th>
                  <td className="text-right text-muted-foreground">
                    {wholeMoney(row.revenue, currency)}
                  </td>
                  <td className="w-12 text-right font-medium">
                    {pct(row.shareOfSubtotal)}
                  </td>
                  <td
                    className="w-20 text-right text-xs text-muted-foreground"
                    title="Own margin, before the Quote Discount"
                  >
                    {row.lineCount > 0 ? `${pct(row.marginPct)} margin` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-auto pt-4">
            <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border">
              <Ratio label="Blended rate" value={perHour(revenue)} unit="/h" />
              <Ratio label="Blended cost" value={perHour(cost)} unit="/h" />
              <Ratio
                label="Subtotal"
                value={wholeMoney(totals.subtotal, currency)}
              />
            </dl>
          </div>
        </>
      )}
    </OverviewCard>
  )
}

function Ratio({
  label,
  value,
  unit,
}: {
  label: string
  value: string
  unit?: string
}) {
  return (
    <div className="flex flex-col gap-0.5 bg-card px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="figure truncate text-base font-semibold">
        {value}
        {unit && value !== "—" && (
          <span className="font-sans text-xs font-normal text-muted-foreground">
            {unit}
          </span>
        )}
      </dd>
    </div>
  )
}
