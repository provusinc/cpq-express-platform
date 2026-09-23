"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import {
  CheckIcon,
  CircleDotIcon,
  MailCheckIcon,
  SendIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import type { ApprovalStepAction } from "@workspace/domain/enums"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { QUOTE_POLL_MS } from "@/components/quotes/autosave"
import { QuoteStatusBadge } from "@/components/quotes/quote-status-badge"
import { formatDateTime } from "@/lib/format"
import { useTRPC } from "@/trpc/react"

/** How each Approval Step action reads in the history. */
export const APPROVAL_STEP_LABELS: Record<ApprovalStepAction, string> = {
  submit: "Submitted for approval",
  approve: "Approved",
  reject: "Rejected",
  recall: "Recalled",
  mark_sent: "Marked as sent",
  customer_approved: "Customer approved",
  customer_rejected: "Customer rejected",
}

const ICONS: Partial<Record<ApprovalStepAction, LucideIcon>> = {
  submit: SendIcon,
  approve: CheckIcon,
  reject: XIcon,
  recall: Undo2Icon,
  mark_sent: MailCheckIcon,
  customer_approved: CheckIcon,
  customer_rejected: XIcon,
}

/**
 * The Quote's approval history (`quote.approvalHistory`): every Approval
 * Step, newest first, with who did it, when, the status it led to and the
 * comment. The Summary tab prefetches it.
 */
export function ApprovalHistory({ quoteId }: { quoteId: string }) {
  const trpc = useTRPC()
  const { steps } = useSuspenseQuery({
    ...trpc.quote.approvalHistory.queryOptions({ id: quoteId }),
    refetchInterval: QUOTE_POLL_MS,
  }).data
  const newestFirst = [...steps].reverse()
  return (
    <Card>
      <CardHeader>
        <CardTitle>Approval history</CardTitle>
        <CardDescription>
          Every submission, decision, recall, sending and customer answer, with
          its comment.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {newestFirst.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This Quote hasn&apos;t been submitted for approval yet.
          </p>
        ) : (
          <ol className="flex flex-col gap-4">
            {newestFirst.map((step) => {
              const Icon = ICONS[step.action] ?? CircleDotIcon
              return (
                <li key={step.id} className="flex gap-3">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border bg-muted">
                    <Icon className="size-3.5" aria-hidden />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className="font-medium">
                        {APPROVAL_STEP_LABELS[step.action]}
                      </span>
                      <span className="text-muted-foreground">
                        by {step.actor.name ?? step.actor.email}
                      </span>
                      <QuoteStatusBadge status={step.toStatus} />
                    </div>
                    <time
                      className="text-xs text-muted-foreground"
                      dateTime={new Date(step.createdAt).toISOString()}
                    >
                      {formatDateTime(step.createdAt)}
                    </time>
                    {step.comment && (
                      <p className="rounded-md bg-muted/60 px-3 py-2 text-sm whitespace-pre-wrap">
                        {step.comment}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
