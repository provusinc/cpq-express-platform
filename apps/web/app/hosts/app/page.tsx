import { redirect } from "next/navigation"

import { SignOutButton } from "@/components/auth/sign-out-button"
import { getCaller } from "@/trpc/server"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

/** Home of the app host. The Organization picker replaces this in a later ticket. */
export default async function AppHomePage() {
  const session = await (await getCaller()).auth.getSession()
  if (!session) redirect("/sign-in")

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>You&apos;re signed in</CardTitle>
          <CardDescription>
            Signed in as {session.user.email}
            {session.user.isPlatformAdmin ? " (Platform Admin)" : ""}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignOutButton />
        </CardContent>
      </Card>
    </main>
  )
}
