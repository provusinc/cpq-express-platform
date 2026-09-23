"use client"

import { CheckIcon, ChevronsUpDownIcon, LayoutGridIcon } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar"

import type { ShellOrganization } from "./types"

/**
 * Jumps between the Organizations the User holds a Membership in. Each one
 * lives on its own subdomain, so switching is a full page load; the shared
 * session cookie keeps the User signed in.
 */
export function OrganizationSwitcher({
  current,
  organizations,
  pickerUrl,
}: {
  current: ShellOrganization
  organizations: ShellOrganization[]
  pickerUrl: string
}) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-popup-open:bg-sidebar-accent"
                aria-label="Switch Organization"
              />
            }
          >
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-medium text-sidebar-primary-foreground">
              {initial(current.name)}
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{current.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {current.slug}
              </span>
            </div>
            <ChevronsUpDownIcon className="ml-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-56" align="start">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Organizations</DropdownMenuLabel>
              {organizations.map((organization) => (
                <DropdownMenuItem
                  key={organization.slug}
                  render={<a href={organization.url} />}
                >
                  <span className="flex size-6 items-center justify-center rounded-md border text-xs">
                    {initial(organization.name)}
                  </span>
                  <span className="truncate">{organization.name}</span>
                  {organization.slug === current.slug && (
                    <CheckIcon className="ml-auto" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<a href={pickerUrl} />}>
              <LayoutGridIcon />
              All Organizations
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function initial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?"
}
