"use client"

import { useMemo, useState } from "react"

import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@workspace/ui/components/sidebar"
import { TooltipProvider } from "@workspace/ui/components/tooltip"

import type { Labels } from "@workspace/domain/settings"

import { CreateQuoteDialog } from "@/components/quotes/create-quote-dialog"
import { ThemeToggle } from "@/components/theme-toggle"

import { AppSidebar } from "./app-sidebar"
import { Breadcrumbs } from "./breadcrumbs"
import { CommandMenu, CommandMenuTrigger } from "./command-menu"
import { LabelsProvider } from "./labels"
import { ShellProvider } from "./shell-context"
import type { ShellOrganization, ShellUser } from "./types"

/**
 * The Organization app shell: the inset sidebar (Organization switcher,
 * grouped navigation, user menu) and the page panel with its sticky header
 * (breadcrumbs on nested pages, the ⌘K command menu — which also starts a
 * New Quote — and the theme toggle).
 * Rendered by the Organization layout once the Membership check has passed.
 */
export function AppShell({
  children,
  labels,
  isAdmin,
  isApprover,
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
  const [creating, setCreating] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const shell = useMemo(
    () => ({
      organization: sidebar.organization,
      isAdmin,
      isApprover,
      newQuote: () => setCreating(true),
      openCommandMenu: () => setCommandOpen(true),
    }),
    [sidebar.organization, isAdmin, isApprover]
  )

  return (
    <LabelsProvider labels={labels}>
      <ShellProvider value={shell}>
        <TooltipProvider>
          <SidebarProvider>
            <AppSidebar {...sidebar} />
            <SidebarInset className="min-w-0 md:peer-data-[variant=inset]:shadow-panel">
              <header className="sticky top-0 z-30 flex h-13 shrink-0 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur-md supports-backdrop-filter:bg-background/70 md:rounded-t-xl md:px-4">
                <SidebarTrigger className="-ml-1 text-muted-foreground" />
                <Breadcrumbs />
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  <CommandMenuTrigger className="w-9 justify-center px-0 lg:w-56 lg:justify-start lg:pr-1.5 lg:pl-2.5 xl:w-64" />
                  <ThemeToggle />
                </div>
              </header>
              <div className="flex min-w-0 flex-1 flex-col gap-5 px-4 pt-5 pb-8 md:px-6 lg:px-8">
                {children}
              </div>
            </SidebarInset>
            <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
            <CreateQuoteDialog open={creating} onOpenChange={setCreating} />
          </SidebarProvider>
        </TooltipProvider>
      </ShellProvider>
    </LabelsProvider>
  )
}
