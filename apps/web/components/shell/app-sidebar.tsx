"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@workspace/ui/components/sidebar"

import { useTRPC } from "@/trpc/react"

import { NAV_SECTIONS } from "./nav"
import type { NavItem, NavSection } from "./nav"
import { OrganizationSwitcher } from "./organization-switcher"
import { useNavItems, useShell } from "./shell-context"
import type { ShellOrganization, ShellUser } from "./types"
import { UserMenu } from "./user-menu"

const SECTIONS: NavSection[] = [...NAV_SECTIONS, "Organization"]

/**
 * The inset sidebar: the Organization switcher, the navigation grouped by
 * section (the Approver's queue shows its count), and the user menu.
 */
export function AppSidebar({
  organization,
  organizations,
  user,
  pickerUrl,
  signedOutUrl,
}: {
  organization: ShellOrganization
  organizations: ShellOrganization[]
  user: ShellUser
  pickerUrl: string
  signedOutUrl: string
}) {
  const items = useNavItems()
  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader className="pb-0">
        <OrganizationSwitcher
          current={organization}
          organizations={organizations}
          pickerUrl={pickerUrl}
        />
      </SidebarHeader>
      <SidebarContent className="gap-0 pt-2">
        {SECTIONS.map((section) => {
          const inSection = items.filter((item) => item.section === section)
          if (inSection.length === 0) return null
          return (
            <SidebarGroup
              key={section}
              className={section === "Organization" ? "mt-auto" : "py-1"}
            >
              <SidebarGroupLabel className="h-7 text-[0.7rem] font-medium tracking-wide text-sidebar-foreground/55">
                {section}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <NavMenu items={inSection} />
              </SidebarGroupContent>
            </SidebarGroup>
          )
        })}
      </SidebarContent>
      <SidebarFooter>
        <UserMenu user={user} signedOutUrl={signedOutUrl} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function NavMenu({ items }: { items: NavItem[] }) {
  // Organization pages render per request, so the path matches the browser's.
  const pathname = usePathname()
  return (
    <SidebarMenu className="gap-0.5">
      {items.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`)
        return (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton
              render={<Link href={item.href} />}
              isActive={active}
              tooltip={item.label}
              className="relative font-normal text-sidebar-foreground/85 data-active:bg-background data-active:font-medium data-active:text-sidebar-accent-foreground data-active:shadow-panel [&>svg]:text-sidebar-foreground/60 data-active:[&>svg]:text-primary"
            >
              <item.icon />
              <span>{item.label}</span>
            </SidebarMenuButton>
            {item.approverOnly && <ApprovalCount />}
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}

/** How many Quotes wait for the Approver (hidden at zero). */
function ApprovalCount() {
  const trpc = useTRPC()
  const { isApprover } = useShell()
  const { data } = useQuery({
    ...trpc.quote.awaitingMyApproval.queryOptions({ page: 1, pageSize: 1 }),
    enabled: isApprover,
    refetchInterval: 60_000,
  })
  const total = data?.total ?? 0
  if (total === 0) return null
  return (
    <SidebarMenuBadge
      aria-label={`${total} awaiting approval`}
      className="bg-warning-soft text-warning-ink peer-hover/menu-button:text-warning-ink peer-data-active/menu-button:text-warning-ink"
    >
      {total}
    </SidebarMenuBadge>
  )
}
