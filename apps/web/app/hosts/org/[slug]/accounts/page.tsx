import type { Metadata } from "next"

import { AccountsList } from "@/components/accounts/accounts-list"
import { INITIAL_ACCOUNT_LIST_INPUT } from "@/components/accounts/list-input"
import { HydrateClient, prefetch, prefetchNow, trpc } from "@/trpc/server"

export const metadata: Metadata = { title: "Accounts · CPQ Express" }

export default async function AccountsPage() {
  // The list reads it with `useQuery`: settle it before rendering.
  await prefetchNow(trpc.account.list.queryOptions(INITIAL_ACCOUNT_LIST_INPUT))
  prefetch(trpc.account.filterOptions.queryOptions())
  return (
    <HydrateClient>
      <AccountsList />
    </HydrateClient>
  )
}
