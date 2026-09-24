import { TRPCError } from "@trpc/server"
import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { AccountDetail } from "@/components/accounts/account-detail"
import { getCaller, HydrateClient, prefetch, trpc } from "@/trpc/server"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Loads the Account, or null when it isn't this Organization's. */
async function findAccount(accountId: string) {
  if (!UUID.test(accountId)) return null
  return (await getCaller()).account.byId({ id: accountId }).catch((error) => {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") return null
    throw error
  })
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; accountId: string }>
}): Promise<Metadata> {
  const account = await findAccount((await params).accountId)
  return { title: `${account?.name ?? "Account"} · CPQ Express` }
}

export default async function AccountPage({
  params,
}: {
  params: Promise<{ slug: string; accountId: string }>
}) {
  const { accountId } = await params
  if (!(await findAccount(accountId))) notFound()
  prefetch(trpc.account.byId.queryOptions({ id: accountId }))
  return (
    <HydrateClient>
      <AccountDetail accountId={accountId} />
    </HydrateClient>
  )
}
