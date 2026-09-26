import type { Metadata } from "next"

import { CustomersList } from "@/components/customers/customers-list"
import { INITIAL_CUSTOMER_LIST_INPUT } from "@/components/customers/list-input"
import { HydrateClient, prefetch, prefetchNow, trpc } from "@/trpc/server"

export const metadata: Metadata = { title: "Customers · CPQ Express" }

export default async function CustomersPage() {
  // The list reads it with `useQuery`: settle it before rendering.
  await prefetchNow(
    trpc.customer.list.queryOptions(INITIAL_CUSTOMER_LIST_INPUT)
  )
  prefetch(trpc.customer.filterOptions.queryOptions())
  return (
    <HydrateClient>
      <CustomersList />
    </HydrateClient>
  )
}
