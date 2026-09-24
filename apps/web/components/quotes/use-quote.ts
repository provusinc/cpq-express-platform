"use client"

import { useSuspenseQuery } from "@tanstack/react-query"

import type { RouterOutputs } from "@workspace/api"

import { useTRPC } from "@/trpc/react"

import { QUOTE_POLL_MS } from "./autosave"

export type Quote = RouterOutputs["quote"]["byId"]

/**
 * The open Quote: `quote.byId`, refetched on window focus and every 30 s.
 * Every editor component reads the Quote through this.
 */
export function useQuote(quoteId: string) {
  const trpc = useTRPC()
  return useSuspenseQuery({
    ...trpc.quote.byId.queryOptions({ id: quoteId }),
    refetchOnWindowFocus: true,
    refetchInterval: QUOTE_POLL_MS,
  }).data
}
