import { MailXIcon } from "lucide-react"

import { buttonVariants } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

/** An Invitation link that can't be used: unknown, expired, withdrawn or used. */
export function InvitationUnavailable({
  title,
  message,
  organization,
}: {
  title: string
  message: string
  /** Set when the viewer already belongs to the Invitation's Organization. */
  organization?: { name: string; url: string }
}) {
  return (
    <Card>
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-full bg-muted">
          <MailXIcon className="size-5 text-muted-foreground" />
        </div>
        <CardTitle className="text-xl">{title}</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      {organization && (
        <CardContent>
          <a
            href={organization.url}
            className={buttonVariants({ className: "w-full" })}
          >
            Go to {organization.name}
          </a>
        </CardContent>
      )}
    </Card>
  )
}
