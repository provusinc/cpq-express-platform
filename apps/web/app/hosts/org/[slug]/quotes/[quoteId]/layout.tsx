import { TRPCError } from "@trpc/server"
import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { ApprovalActions } from "@/components/approval/approval-actions"
import { QuoteHeader } from "@/components/quotes/quote-header"
import { QuoteTabs } from "@/components/quotes/quote-tabs"
import { getCaller, HydrateClient, prefetch, trpc } from "@/trpc/server"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Loads the Quote, or null when the id isn't a UUID or not this Organization's. */
async function findQuote(quoteId: string) {
  if (!UUID.test(quoteId)) return null
  return (await getCaller()).quote.byId({ id: quoteId }).catch((error) => {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") return null
    throw error
  })
}

type Params = Promise<{ slug: string; quoteId: string }>

export async function generateMetadata({
  params,
}: {
  params: Params
}): Promise<Metadata> {
  const quote = await findQuote((await params).quoteId)
  return { title: `${quote?.name ?? "Quote"} · CPQ Express` }
}

/**
 * The Quote editor at `/quotes/<uuid>`: the header (Name, Description,
 * status, Account, Owner) and the tab bar, above the current tab's route
 * (`QUOTE_TABS` in components/quotes/tabs.ts). Unknown, malformed and other
 * Organizations' ids are a 404.
 */
export default async function QuoteLayout({
  params,
  children,
}: {
  params: Params
  children: React.ReactNode
}) {
  const { quoteId } = await params
  if (!(await findQuote(quoteId))) notFound()
  prefetch(trpc.quote.byId.queryOptions({ id: quoteId }))
  return (
    <HydrateClient>
      <QuoteHeader
        quoteId={quoteId}
        actions={<ApprovalActions quoteId={quoteId} />}
      />
      <QuoteTabs quoteId={quoteId} />
      {children}
    </HydrateClient>
  )
}
