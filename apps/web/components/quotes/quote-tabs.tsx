"use client"

import Link from "next/link"
import { useSelectedLayoutSegment } from "next/navigation"
import { useEffect, useState } from "react"

import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"

import { QuoteSaveIndicator } from "./autosave"
import { CompactQuoteFigures, QUOTE_METRICS_ID } from "./quote-header"
import { WithQuoteFigures } from "./quote-figures"
import { QUOTE_TABS } from "./tabs"
import { useQuote } from "./use-quote"

const INDEX = "overview"
/** The shell header's height (`h-13`) plus this bar's (`h-11`). */
const STUCK_OFFSET_PX = 52 + 44

/**
 * The Quote editor's sticky bar, just under the shell header: the tab bar
 * (one link per tab route, the current one underlined) and, at its right,
 * the save state. Once the header's metrics strip has scrolled under it,
 * Total and Margin % join it, so they stay in view on every tab without
 * ever showing twice.
 */
export function QuoteTabs({ quoteId }: { quoteId: string }) {
  const segment = useSelectedLayoutSegment() ?? INDEX
  const metricsHidden = useMetricsHidden()
  const canEdit = useQuote(quoteId).permissions.canEdit
  return (
    <div className="sticky top-13 z-20 -mx-4 -mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-1 border-b bg-background/90 px-4 backdrop-blur-md supports-backdrop-filter:bg-background/75 md:-mx-6 md:px-6 lg:-mx-8 lg:px-8">
      <Tabs value={segment} className="-mb-px max-w-full min-w-0">
        <TabsList
          variant="line"
          aria-label="Quote"
          className="no-scrollbar h-11! max-w-full justify-start gap-0 overflow-x-auto p-0"
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
      <div className="ml-auto flex items-center gap-5 self-center">
        <QuoteSaveIndicator
          quoteId={quoteId}
          idle={canEdit ? "Edits save automatically" : undefined}
        />
        {metricsHidden && (
          <WithQuoteFigures quoteId={quoteId}>
            {(figures) => <CompactQuoteFigures figures={figures} />}
          </WithQuoteFigures>
        )}
      </div>
    </div>
  )
}

/** Whether the header's metrics strip has scrolled up under the sticky bars. */
function useMetricsHidden() {
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    const metrics = document.getElementById(QUOTE_METRICS_ID)
    if (!metrics) return
    const observer = new IntersectionObserver(
      ([entry]) =>
        setHidden(
          !entry!.isIntersecting &&
            entry!.boundingClientRect.top < STUCK_OFFSET_PX
        ),
      { rootMargin: `-${STUCK_OFFSET_PX}px 0px 0px 0px` }
    )
    observer.observe(metrics)
    return () => observer.disconnect()
  }, [])
  return hidden
}
