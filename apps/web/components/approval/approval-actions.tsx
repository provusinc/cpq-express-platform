"use client"

import { useQueryClient } from "@tanstack/react-query"
import { CheckIcon, SendIcon, Undo2Icon, XIcon } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

import { useQuoteCommand } from "@/components/quotes/autosave"
import { useQuote } from "@/components/quotes/quote-header"
import { useTRPC } from "@/trpc/react"

/** The longest comment the API accepts (APPROVAL_COMMENT_MAX). */
const COMMENT_MAX = 2000

type Transition = "submit" | "approve" | "reject" | "recall"

const TRANSITIONS: Record<
  Transition,
  {
    label: string
    icon: LucideIcon
    title: string
    description: string
    placeholder: string
    done: string
    variant: "default" | "outline" | "destructive"
  }
> = {
  submit: {
    label: "Submit for approval",
    icon: SendIcon,
    title: "Submit for approval",
    description:
      "An Approver will approve or reject it. The Quote is locked until then; you can recall it to make changes.",
    placeholder: "Anything the Approver should know (optional)",
    done: "Submitted for approval",
    variant: "default",
  },
  approve: {
    label: "Approve",
    icon: CheckIcon,
    title: "Approve this Quote",
    description: "The Owner can then send it to the customer.",
    placeholder: "Comment (optional)",
    done: "Quote approved",
    variant: "default",
  },
  reject: {
    label: "Reject",
    icon: XIcon,
    title: "Reject this Quote",
    description:
      "It returns to its Owner for changes and can be submitted again.",
    placeholder: "Why it's rejected (optional)",
    done: "Quote rejected",
    variant: "destructive",
  },
  recall: {
    label: "Recall",
    icon: Undo2Icon,
    title: "Recall this Quote",
    description:
      "It stops awaiting approval and returns to Draft, so it can be edited again.",
    placeholder: "Comment (optional)",
    done: "Quote recalled to Draft",
    variant: "outline",
  },
}

/** Refusals about the Quote itself, which the Owner can fix (shown on a disabled Submit). */
const FIXABLE_SUBMIT_REASONS = ["total_missing", "total_zero", "total_negative"]

/**
 * The approval actions in the Quote header, per the viewer's `permissions`:
 * Submit (the Owner; disabled with the reason when the Total isn't
 * positive), Approve / Reject (Approvers, never on their own Quote) and
 * Recall (the Owner or an Admin while Pending Approval). Each opens a
 * dialog with an optional comment and runs its command.
 */
export function ApprovalActions({ quoteId }: { quoteId: string }) {
  const quote = useQuote(quoteId)
  const [open, setOpen] = useState<Transition | null>(null)
  const { permissions } = quote
  const submitDenial = permissions.submitDenial

  const shown: Transition[] = []
  if (permissions.canRecall) shown.push("recall")
  if (permissions.canReject) shown.push("reject")
  if (permissions.canApprove) shown.push("approve")
  if (permissions.canSubmit) shown.push("submit")

  const blockedSubmit =
    !permissions.canSubmit &&
    submitDenial &&
    FIXABLE_SUBMIT_REASONS.includes(submitDenial.reason)

  if (shown.length === 0 && !blockedSubmit) return null

  return (
    <div className="flex items-center gap-2">
      {shown.map((transition) => {
        const { label, icon: Icon, variant } = TRANSITIONS[transition]
        return (
          <Button
            key={transition}
            variant={variant === "destructive" ? "outline" : variant}
            onClick={() => setOpen(transition)}
          >
            <Icon />
            {label}
          </Button>
        )
      })}
      {blockedSubmit && (
        <Tooltip>
          <TooltipTrigger render={<span tabIndex={0} />}>
            <Button disabled>
              <SendIcon />
              {TRANSITIONS.submit.label}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{submitDenial.message}</TooltipContent>
        </Tooltip>
      )}
      {open && (
        <TransitionDialog
          quoteId={quoteId}
          transition={open}
          onOpenChange={(next) => !next && setOpen(null)}
        />
      )}
    </div>
  )
}

function useTransitionCommand(quoteId: string, transition: Transition) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const options = {
    submit: trpc.quote.submit.mutationOptions(),
    approve: trpc.quote.approve.mutationOptions(),
    reject: trpc.quote.reject.mutationOptions(),
    recall: trpc.quote.recall.mutationOptions(),
  }[transition]
  return useQuoteCommand(quoteId, options, {
    onSuccess: () => {
      toast.success(TRANSITIONS[transition].done)
      void queryClient.invalidateQueries(
        trpc.quote.approvalHistory.queryFilter({ id: quoteId })
      )
      void queryClient.invalidateQueries(
        trpc.quote.awaitingMyApproval.pathFilter()
      )
    },
  })
}

function TransitionDialog({
  quoteId,
  transition,
  onOpenChange,
}: {
  quoteId: string
  transition: Transition
  onOpenChange: (open: boolean) => void
}) {
  const [comment, setComment] = useState("")
  const command = useTransitionCommand(quoteId, transition)
  const copy = TRANSITIONS[transition]
  const confirm = () =>
    command.mutate(
      { id: quoteId, comment: comment.trim() || null },
      { onSuccess: () => onOpenChange(false) }
    )
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="approval-comment">Comment</FieldLabel>
          <Textarea
            id="approval-comment"
            value={comment}
            maxLength={COMMENT_MAX}
            placeholder={copy.placeholder}
            onChange={(event) => setComment(event.target.value)}
            rows={4}
          />
        </Field>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={command.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant={copy.variant}
            disabled={command.isPending}
            onClick={confirm}
          >
            {command.isPending ? "Working…" : copy.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
