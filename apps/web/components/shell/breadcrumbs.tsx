"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Fragment } from "react"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb"

import { QUOTE_TABS } from "@/components/quotes/tabs"
import { SETTINGS_TABS } from "@/components/settings/tabs"
import { useTRPC } from "@/trpc/react"

import { useNavItems } from "./shell-context"
import { useHydrated } from "./use-hydrated"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Crumb {
  href: string
  label: React.ReactNode
}

/**
 * Where the page sits, derived from the route: the nav entry, then the
 * record (its name from the page's own cached query, never a new fetch),
 * then the Quote tab or Settings tab.
 */
export function Breadcrumbs() {
  const pathname = usePathname()
  const nav = useNavItems()
  const parts = pathname.split("/").filter(Boolean)
  const crumbs: Crumb[] = []
  const root = nav.find((item) => item.href === `/${parts[0]}`)
  if (root) crumbs.push({ href: root.href, label: root.label })

  if (parts[0] === "quotes" && parts[1] && UUID.test(parts[1])) {
    crumbs.push({
      href: `/quotes/${parts[1]}`,
      label: <QuoteName id={parts[1]} />,
    })
    const tab = QUOTE_TABS.find((t) => t.segment === (parts[2] ?? null))
    if (tab && parts[2]) {
      crumbs.push({ href: `/quotes/${parts[1]}${tab.path}`, label: tab.label })
    }
  } else if (parts[0] === "accounts" && parts[1] && UUID.test(parts[1])) {
    crumbs.push({
      href: `/accounts/${parts[1]}`,
      label: <AccountName id={parts[1]} />,
    })
  } else if (parts[0] === "settings" && parts[1]) {
    const tab = SETTINGS_TABS.find((t) => t.segment === parts[1])
    if (tab) crumbs.push({ href: tab.href, label: tab.label })
  }

  if (crumbs.length === 0) return null
  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1
          return (
            <Fragment key={crumb.href}>
              {i > 0 && (
                <BreadcrumbSeparator className="text-muted-foreground/50">
                  /
                </BreadcrumbSeparator>
              )}
              <BreadcrumbItem className={last ? "min-w-0" : "shrink-0"}>
                {last ? (
                  <BreadcrumbPage className="truncate font-medium">
                    {crumb.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    render={<Link href={crumb.href} />}
                    className="max-w-56 truncate"
                  >
                    {crumb.label}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

function QuoteName({ id }: { id: string }) {
  return useHydrated() ? <CachedQuoteName id={id} /> : <>Quote</>
}

function AccountName({ id }: { id: string }) {
  return useHydrated() ? <CachedAccountName id={id} /> : <>Account</>
}

function CachedQuoteName({ id }: { id: string }) {
  const trpc = useTRPC()
  const { data } = useQuery({
    ...trpc.quote.byId.queryOptions({ id }),
    enabled: false,
  })
  return <>{data?.name ?? "Quote"}</>
}

function CachedAccountName({ id }: { id: string }) {
  const trpc = useTRPC()
  const { data } = useQuery({
    ...trpc.account.byId.queryOptions({ id }),
    enabled: false,
  })
  return <>{data?.name ?? "Account"}</>
}
