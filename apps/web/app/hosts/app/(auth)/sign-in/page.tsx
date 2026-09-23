import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { SignInForm } from "@/components/auth/sign-in-form"
import { env } from "@/env"
import { getCaller } from "@/trpc/server"
import { resolveRedirect } from "@workspace/auth"
import { oauthProviders } from "@workspace/auth/next"

export const metadata: Metadata = { title: "Sign in · CPQ Express" }

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = await searchParams
  const callbackUrl = resolveRedirect(
    typeof query.callbackUrl === "string" ? query.callbackUrl : "/",
    env.APP_URL,
    { appUrl: env.APP_URL, rootDomain: env.ROOT_DOMAIN }
  )

  const session = await (await getCaller()).auth.getSession()
  if (session) redirect(callbackUrl)

  return (
    <SignInForm
      callbackUrl={callbackUrl}
      error={typeof query.error === "string" ? query.error : undefined}
      oauthProviders={oauthProviders}
    />
  )
}
