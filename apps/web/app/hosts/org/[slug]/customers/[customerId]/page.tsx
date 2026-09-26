import { TRPCError } from "@trpc/server"
import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { CustomerDetail } from "@/components/customers/customer-detail"
import { getCaller, HydrateClient, prefetch, trpc } from "@/trpc/server"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Loads the Customer, or null when it isn't this Organization's. */
async function findCustomer(customerId: string) {
  if (!UUID.test(customerId)) return null
  return (await getCaller()).customer
    .byId({ id: customerId })
    .catch((error) => {
      if (error instanceof TRPCError && error.code === "NOT_FOUND") return null
      throw error
    })
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; customerId: string }>
}): Promise<Metadata> {
  const customer = await findCustomer((await params).customerId)
  return { title: `${customer?.name ?? "Customer"} · CPQ Express` }
}

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ slug: string; customerId: string }>
}) {
  const { customerId } = await params
  if (!(await findCustomer(customerId))) notFound()
  prefetch(trpc.customer.byId.queryOptions({ id: customerId }))
  return (
    <HydrateClient>
      <CustomerDetail customerId={customerId} />
    </HydrateClient>
  )
}
