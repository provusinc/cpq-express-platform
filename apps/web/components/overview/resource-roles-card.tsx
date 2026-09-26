"use client"

import { UsersRoundIcon } from "lucide-react"

import type { RouterOutputs } from "@workspace/api"
import { Decimal } from "@workspace/domain/money"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item"
import { Progress } from "@workspace/ui/components/progress"

import type { EditorLine } from "@/components/quotes/autosave"
import { useLabels } from "@/components/shell/labels"
import { compactHours, initials } from "@/lib/figures"
import { wholeMoney } from "@/lib/money"

import { OverviewCard } from "./overview-card"

type Role = RouterOutputs["quote"]["overview"]["resourceRoles"][number]

/** Rows shown before "+ n more". */
const SHOWN = 5

/**
 * Who does the work: each Resource Role on the Quote with its Effort (Σ
 * hours of its lines, from the editor so it follows edits), its share of
 * the Quote's Resource Role hours and its average bill rate here, most
 * Effort first. Named with the
 * Resource Role Label Override.
 */
export function ResourceRolesCard({
  quoteId,
  lines,
  roles,
  currency,
}: {
  quoteId: string
  currency: string
  lines: readonly EditorLine[]
  roles: readonly Role[]
}) {
  const labels = useLabels()
  const term = labels.resource_role
  const hoursByRole = new Map<string, Decimal>()
  const revenueByRole = new Map<string, Decimal>()
  for (const line of lines) {
    const id = line.resourceRoleId
    if (line.sourceKind !== "resource_role" || !id) continue
    hoursByRole.set(
      id,
      (hoursByRole.get(id) ?? new Decimal(0)).plus(line.quantity)
    )
    revenueByRole.set(
      id,
      (revenueByRole.get(id) ?? new Decimal(0)).plus(line.lineTotal)
    )
  }
  const total = [...hoursByRole.values()].reduce(
    (sum, h) => sum.plus(h),
    new Decimal(0)
  )
  const rows = roles
    .filter((role) => hoursByRole.has(role.id))
    .map((role) => {
      const hours = hoursByRole.get(role.id)!
      return {
        ...role,
        hours,
        rate: hours.isZero()
          ? null
          : revenueByRole.get(role.id)!.div(hours).toFixed(4),
        share: total.isZero() ? 0 : hours.div(total).times(100).toNumber(),
      }
    })
    .sort((a, b) => b.hours.comparedTo(a.hours))

  return (
    <OverviewCard
      title={term.plural}
      description={
        rows.length > 0
          ? `${rows.length} on this Quote, by Effort`
          : `None on this Quote yet`
      }
      link={{ href: `/quotes/${quoteId}/planner`, label: "Plan" }}
    >
      {rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center text-sm text-muted-foreground">
          <UsersRoundIcon className="size-5" aria-hidden />
          Add {term.plural} on the Line Items tab to plan the work.
        </div>
      ) : (
        <ItemGroup className="-mx-3 gap-0">
          {rows.slice(0, SHOWN).map((role) => (
            <Item key={role.id} size="xs" role="listitem" className="py-1.5">
              <ItemMedia>
                <Avatar className="size-8 rounded-lg after:rounded-lg">
                  <AvatarFallback className="rounded-lg bg-series-1/15 text-xs font-semibold text-series-1">
                    {initials(role.name)}
                  </AvatarFallback>
                </Avatar>
              </ItemMedia>
              <ItemContent className="min-w-0 gap-1">
                <ItemTitle
                  className="w-full truncate"
                  title={
                    [role.locationCity, role.locationCountry]
                      .filter(Boolean)
                      .join(", ") || undefined
                  }
                >
                  {role.name}
                </ItemTitle>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Progress
                    value={role.share}
                    aria-hidden
                    className="w-full max-w-32 gap-0 **:data-[slot=progress-indicator]:bg-series-1 **:data-[slot=progress-track]:h-1"
                  />
                  <span className="shrink-0 tabular-nums">
                    {Math.round(role.share)}%
                  </span>
                </div>
              </ItemContent>
              <ItemActions className="flex-col items-end gap-0.5">
                <span className="figure text-base leading-5 font-medium">
                  {compactHours(role.hours.toFixed(3))}
                  <span className="ml-0.5 font-sans text-xs text-muted-foreground">
                    h
                  </span>
                </span>
                {role.rate && (
                  <span
                    className="text-xs text-muted-foreground tabular-nums"
                    title="Average bill rate on this Quote"
                  >
                    {wholeMoney(role.rate, currency)}/h
                  </span>
                )}
              </ItemActions>
            </Item>
          ))}
          {rows.length > SHOWN && (
            <p className="px-3 pt-1 text-xs text-muted-foreground">
              and {rows.length - SHOWN} more
            </p>
          )}
        </ItemGroup>
      )}
    </OverviewCard>
  )
}
