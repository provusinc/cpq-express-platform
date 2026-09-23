import { Building2Icon, MailIcon, PhoneIcon, UserRoundIcon } from "lucide-react"

import type { RouterOutputs } from "@workspace/api"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"

import { initials } from "@/lib/figures"

import { OverviewCard } from "./overview-card"

type Overview = RouterOutputs["quote"]["overview"]

/**
 * Who the Quote is for: the Account (industry, type and billing city) and
 * its primary Contact (Quotes reach Contacts only through their Account),
 * linking to the Account for the rest.
 */
export function CustomerCard({
  account,
  contact,
}: {
  account: Overview["account"]
  contact: Overview["primaryContact"]
}) {
  const place = [account.city, account.state ?? account.country]
    .filter(Boolean)
    .join(", ")
  const facts = [account.industry, account.type, place].filter(Boolean)
  return (
    <OverviewCard
      title="Account"
      link={{ href: `/accounts/${account.id}`, label: "Open" }}
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Building2Icon className="size-4.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium">{account.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {facts.length > 0 ? facts.join(" · ") : "No details yet"}
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-1 flex-col gap-3 border-t pt-4">
        <p className="text-xs font-medium text-muted-foreground">
          Primary Contact
        </p>
        {contact ? (
          <div className="flex items-start gap-3">
            <Avatar className="size-10">
              <AvatarFallback className="bg-iris-soft text-sm font-medium text-iris-ink">
                {initials(contact.name) || <UserRoundIcon />}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col gap-1">
              <p className="leading-tight font-medium">
                {contact.name}
                {contact.title && (
                  <span className="block pt-0.5 text-xs font-normal text-muted-foreground">
                    {contact.title}
                  </span>
                )}
              </p>
              {contact.email && (
                <a
                  href={`mailto:${contact.email}`}
                  className="flex items-center gap-1.5 truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  <MailIcon className="size-3.5 shrink-0" aria-hidden />
                  {contact.email}
                </a>
              )}
              {contact.phone && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <PhoneIcon className="size-3.5 shrink-0" aria-hidden />
                  {contact.phone}
                </span>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            The Account has no primary Contact yet.
          </p>
        )}
      </div>
    </OverviewCard>
  )
}
