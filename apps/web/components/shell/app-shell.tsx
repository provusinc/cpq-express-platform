"use client"

import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@workspace/ui/components/sidebar"
import { Separator } from "@workspace/ui/components/separator"
import { TooltipProvider } from "@workspace/ui/components/tooltip"

import type { Labels } from "@workspace/domain/settings"

import { AppSidebar } from "./app-sidebar"
import { LabelsProvider } from "./labels"
import type { ShellOrganization, ShellUser } from "./types"

/**
 * The Organization app shell: sidebar (navigation, Organization switcher,
 * user menu) and the page area. Rendered by the Organization layout once the
 * Membership check has passed.
 */
export function AppShell({
  children,
  labels,
  ...sidebar
}: {
  children: React.ReactNode
  /** The Organization's labels, for `useLabels()` anywhere in the page. */
  labels: Labels
  organization: ShellOrganization
  organizations: ShellOrganization[]
  isAdmin: boolean
  isApprover: boolean
  user: ShellUser
  pickerUrl: string
  signedOutUrl: string
}) {
  return (
    <LabelsProvider labels={labels}>
      <TooltipProvider>
        <SidebarProvider>
          <AppSidebar {...sidebar} />
          <SidebarInset className="min-w-0">
            <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4 transition-[width,height] ease-linear">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 h-4" />
              <span className="truncate text-sm text-muted-foreground">
                {sidebar.organization.name}
              </span>
            </header>
            <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
              {children}
            </div>
          </SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
    </LabelsProvider>
  )
}
