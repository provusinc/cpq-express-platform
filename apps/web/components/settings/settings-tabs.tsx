"use client"

import Link from "next/link"
import { useSelectedLayoutSegment } from "next/navigation"

import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"

import { SETTINGS_TABS } from "./tabs"

/** The Settings tab bar: one link per tab route, the current one active. */
export function SettingsTabs() {
  const segment = useSelectedLayoutSegment() ?? SETTINGS_TABS[0].segment
  return (
    <Tabs value={segment}>
      <TabsList variant="line" aria-label="Settings">
        {SETTINGS_TABS.map((tab) => (
          <TabsTrigger
            key={tab.segment}
            value={tab.segment}
            nativeButton={false}
            render={<Link href={tab.href} />}
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
