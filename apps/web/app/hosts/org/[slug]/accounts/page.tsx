import type { Metadata } from "next"

import { AccountsList } from "@/components/accounts/accounts-list"
import { INITIAL_ACCOUNT_LIST_INPUT } from "@/components/accounts/list-input"
import { HydrateClient, prefetch, trpc } from "@/trpc/server"

export const metadata: Metadata = { title: "Accounts · CPQ Express" }

export default function AccountsPage() {
  prefetch(trpc.account.list.queryOptions(INITIAL_ACCOUNT_LIST_INPUT))
  prefetch(trpc.account.filterOptions.queryOptions())
  return (
    <HydrateClient>
      <AccountsList />
    </HydrateClient>
  )
}
