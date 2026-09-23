"use client"

import Link from "next/link"
import { useSelectedLayoutSegment } from "next/navigation"

import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"

import { QUOTE_TABS } from "./tabs"

const INDEX = "line-items"

/** The Quote editor's tab bar: one link per tab route, the current one active. */
export function QuoteTabs({ quoteId }: { quoteId: string }) {
  const segment = useSelectedLayoutSegment() ?? INDEX
  return (
    <Tabs value={segment}>
      <TabsList variant="line" aria-label="Quote">
        {QUOTE_TABS.map((tab) => (
          <TabsTrigger
            key={tab.label}
            value={tab.segment ?? INDEX}
            nativeButton={false}
            render={<Link href={`/quotes/${quoteId}${tab.path}`} />}
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
