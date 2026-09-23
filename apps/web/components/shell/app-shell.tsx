"use client"

import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@workspace/ui/components/sidebar"
import { Separator } from "@workspace/ui/components/separator"
import { TooltipProvider } from "@workspace/ui/components/tooltip"

import { AppSidebar } from "./app-sidebar"
import type { ShellOrganization, ShellUser } from "./types"

/**
 * The Organization app shell: sidebar (navigation, Organization switcher,
 * user menu) and the page area. Rendered by the Organization layout once the
 * Membership check has passed.
 */
export function AppShell({
  children,
  ...sidebar
}: {
  children: React.ReactNode
  organization: ShellOrganization
  organizations: ShellOrganization[]
  isAdmin: boolean
  user: ShellUser
  pickerUrl: string
  signedOutUrl: string
}) {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar {...sidebar} />
        <SidebarInset>
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <span className="truncate text-sm text-muted-foreground">
              {sidebar.organization.name}
            </span>
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
