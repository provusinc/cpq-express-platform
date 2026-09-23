"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@workspace/ui/components/sidebar"

import { useLabels } from "./labels"
import { ADMIN_NAV_ITEMS, labelNavItems, NAV_ITEMS } from "./nav"
import type { NavItem } from "./nav"
import { OrganizationSwitcher } from "./organization-switcher"
import type { ShellOrganization, ShellUser } from "./types"
import { UserMenu } from "./user-menu"

export function AppSidebar({
  organization,
  organizations,
  isAdmin,
  isApprover,
  user,
  pickerUrl,
  signedOutUrl,
}: {
  organization: ShellOrganization
  organizations: ShellOrganization[]
  isAdmin: boolean
  isApprover: boolean
  user: ShellUser
  pickerUrl: string
  signedOutUrl: string
}) {
  const labels = useLabels()
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <OrganizationSwitcher
          current={organization}
          organizations={organizations}
          pickerUrl={pickerUrl}
        />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <NavMenu
              items={labelNavItems(
                NAV_ITEMS.filter((item) => !item.approverOnly || isApprover),
                labels
              )}
            />
          </SidebarGroupContent>
        </SidebarGroup>
        {isAdmin && (
          <SidebarGroup className="mt-auto">
            <SidebarGroupContent>
              <NavMenu items={ADMIN_NAV_ITEMS} />
            </SidebarGroupContent>
          </SidebarGroup>
        )}
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
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.href}>
          <SidebarMenuButton
            render={<Link href={item.href} />}
            isActive={
              pathname === item.href || pathname.startsWith(`${item.href}/`)
            }
            tooltip={item.label}
          >
            <item.icon />
            <span>{item.label}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  )
}
