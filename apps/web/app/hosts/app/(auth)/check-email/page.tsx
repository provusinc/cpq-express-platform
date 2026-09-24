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
      <CardHeader>
        <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-accent">
          <MailCheckIcon className="size-5 text-primary" />
        </div>
        <CardTitle className="text-xl font-semibold tracking-[-0.01em]">
          Check your email
        </CardTitle>
        <CardDescription>
          We sent you a sign-in link. Open it on this device to finish signing
          in. The link expires in 24 hours and works once.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link
          href="/sign-in"
          className={buttonVariants({
            variant: "outline",
            className: "w-full",
          })}
        >
          Use a different email
        </Link>
      </CardContent>
    </Card>
  )
}
