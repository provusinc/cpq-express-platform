"use client"

import { useQuery } from "@tanstack/react-query"

import { useHydrated } from "@/components/shell/use-hydrated"
import { effortHours } from "@/lib/figures"
import { useTRPC } from "@/trpc/react"

import { useQuote } from "./use-quote"

/** The open Quote's money and Effort, as the header shows them. */
export interface QuoteFigures {
  currencyCode: string
  subtotal: string
  discountKind: "percent" | "amount" | null
  discountValue: string | null
  discountAmount: string
  total: string
  cost: string
  margin: string
  marginPct: string
  /** Σ quantity of the hourly Line Items. */
  effortHours: string
}

/**
 * Renders `children` with the open Quote's figures. Once hydrated they
 * follow the editor cache (edits re-price there first, optimistically),
 * else the Quote itself. The editor is only observed (`enabled: false`):
 * the tab page fetches it if it needs it, and an observer created before
 * the page's boundary hydrates would break its SSR (see AGENTS.md).
 */
export function WithQuoteFigures({
  quoteId,
  children,
}: {
  quoteId: string
  children: (figures: QuoteFigures) => React.ReactNode
}) {
  const quote = useQuote(quoteId)
  return useHydrated() ? (
    <EditorFigures quoteId={quoteId} fallback={quote}>
      {children}
    </EditorFigures>
  ) : (
    children(quote)
  )
}

function EditorFigures({
  quoteId,
  fallback,
  children,
}: {
  quoteId: string
  fallback: QuoteFigures
  children: (figures: QuoteFigures) => React.ReactNode
}) {
  const trpc = useTRPC()
  const { data } = useQuery({
    ...trpc.quote.editor.queryOptions({ id: quoteId }),
    enabled: false,
  })
  return children(
    data ? { ...data.totals, effortHours: effortHours(data.lines) } : fallback
  )
}
