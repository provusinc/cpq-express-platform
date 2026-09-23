"use client"

import Link from "next/link"
import { useSelectedLayoutSegment } from "next/navigation"

import { cn } from "@workspace/ui/lib/utils"

import { SETTINGS_TABS } from "./tabs"

/**
 * The Settings side nav: one link per section route, the current one
 * marked. A row of links on narrow screens, a column beside the form on
 * wide ones.
 */
export function SettingsTabs() {
  const segment = useSelectedLayoutSegment() ?? SETTINGS_TABS[0].segment
  return (
    <nav aria-label="Settings" className="min-w-0">
      <ul className="-mx-1 no-scrollbar flex gap-1 overflow-x-auto px-1 lg:flex-col lg:overflow-visible">
        {SETTINGS_TABS.map((tab) => {
          const active = tab.segment === segment
          return (
            <li key={tab.segment} className="shrink-0">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
                  active && "bg-accent text-accent-foreground hover:bg-accent"
                )}
              >
                <tab.icon
                  aria-hidden
                  className={cn(
                    "mt-0.5 size-4 shrink-0 text-muted-foreground",
                    active && "text-primary"
                  )}
                />
                <span className="flex flex-col">
                  <span className="font-medium">{tab.label}</span>
                  <span className="hidden text-xs text-muted-foreground lg:block">
                    {tab.description}
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
