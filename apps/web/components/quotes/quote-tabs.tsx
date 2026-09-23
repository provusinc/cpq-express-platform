"use client"

import Link from "next/link"
import { useSelectedLayoutSegment } from "next/navigation"

import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"

import { QuoteLedger } from "./quote-ledger"
import { QUOTE_TABS } from "./tabs"

const INDEX = "line-items"

/**
 * The Quote editor's sticky bar, just under the shell header: the tab bar
 * (one link per tab route, the current one underlined) and the ledger with
 * the Quote's money, so Total and Margin stay in view on every tab.
 */
export function QuoteTabs({ quoteId }: { quoteId: string }) {
  const segment = useSelectedLayoutSegment() ?? INDEX
  return (
    <div className="sticky top-13 z-20 -mx-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-1 border-b bg-background/90 px-4 backdrop-blur-md supports-backdrop-filter:bg-background/75 md:-mx-6 md:px-6 lg:-mx-8 lg:px-8">
      <Tabs value={segment} className="-mb-px max-w-full min-w-0">
        <TabsList
          variant="line"
          aria-label="Quote"
          className="no-scrollbar h-12! max-w-full justify-start gap-0 overflow-x-auto p-0"
        >
          {QUOTE_TABS.map((tab) => (
            <TabsTrigger
              key={tab.label}
              value={tab.segment ?? INDEX}
              nativeButton={false}
              render={<Link href={`/quotes/${quoteId}${tab.path}`} />}
              className="h-full flex-none rounded-none px-3 text-muted-foreground after:bg-primary group-data-horizontal/tabs:after:bottom-0 first:pl-0.5 first:after:left-0.5 data-active:text-foreground"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <QuoteLedger quoteId={quoteId} className="ml-auto py-1.5" />
    </div>
  )
}
