import type { Metadata } from "next"
import Link from "next/link"
import { MailCheckIcon } from "lucide-react"

import { buttonVariants } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

export const metadata: Metadata = { title: "Check your email · CPQ Express" }

export default function CheckEmailPage() {
  return (
    <Card>
      <CardHeader className="text-center">
        <MailCheckIcon className="mx-auto mb-2 size-8 text-muted-foreground" />
        <CardTitle className="text-xl">Check your email</CardTitle>
        <CardDescription>
          We sent you a sign-in link. Open it on this device to finish signing
          in. The link expires in 24 hours and works once.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center">
        <Link href="/sign-in" className={buttonVariants({ variant: "ghost" })}>
          Use a different email
        </Link>
      </CardContent>
    </Card>
  )
}
