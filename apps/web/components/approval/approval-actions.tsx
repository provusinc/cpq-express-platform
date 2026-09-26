"use client"

import { useQueryClient } from "@tanstack/react-query"
import type { UseMutationOptions } from "@tanstack/react-query"
import {
  CheckIcon,
  CircleOffIcon,
  MailCheckIcon,
  MessageSquareReplyIcon,
  RotateCcwIcon,
  SendIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react"
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@workspace/ui/components/field"
import {
  RadioGroup,
  RadioGroupItem,
} from "@workspace/ui/components/radio-group"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

import { useQuoteCommand } from "@/components/quotes/autosave"
import { useQuote } from "@/components/quotes/use-quote"
import { useTRPC } from "@/trpc/react"

/** The longest comment the API accepts (APPROVAL_COMMENT_MAX). */
const COMMENT_MAX = 2000
/** Mark as Sent's notes are also the Document's (QUOTE_DOCUMENT_NOTES_MAX). */
const NOTES_MAX = 1000

type Transition =
  | "submit"
  | "approve"
  | "reject"
  | "recall"
  | "markSent"
  | "customerOutcome"
  | "markLost"
  | "reopen"

/** The customer's answer to a Quote With Customer (`quote.recordCustomerOutcome`). */
type CustomerOutcome = "approved" | "revise" | "lost"

interface TransitionCopy {
  label: string
  /** The dialog's text field (defaults to "Comment"). */
  field?: string
  /** The text field must be filled in (Mark as Lost's reason). */
  required?: boolean
  icon: LucideIcon
  title: string
  description: string
  placeholder: string
  done: string
  variant: "default" | "outline" | "destructive"
}

const TRANSITIONS: Record<Transition, TransitionCopy> = {
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
  markSent: {
    label: "Mark as Sent",
    icon: MailCheckIcon,
    field: "Notes",
    title: "Mark as Sent",
    description:
      "Declares that this Quote has gone to the customer. A Quote Document is captured as proof of what was sent and can never be deleted. The Quote then awaits the customer's answer.",
    placeholder: "How and to whom it was sent (optional)",
    done: "Marked as sent; Quote Document captured",
    variant: "default",
  },
  customerOutcome: {
    label: "Record customer's answer",
    icon: MessageSquareReplyIcon,
    field: "Note",
    title: "Record the customer's answer",
    description: "What did the customer say to this Quote?",
    placeholder: "Note (optional)",
    done: "Customer's answer recorded",
    variant: "default",
  },
  markLost: {
    label: "Mark as Lost",
    icon: CircleOffIcon,
    field: "Reason",
    required: true,
    title: "Mark this Quote as lost",
    description:
      "The deal is dead. The Quote moves to Lost and stays locked; only an Admin can reopen it.",
    placeholder: "Why the deal was lost",
    done: "Quote marked as lost",
    variant: "destructive",
  },
  reopen: {
    label: "Reopen",
    icon: RotateCcwIcon,
    title: "Reopen this Quote",
    description:
      "It leaves Lost and returns to Draft, so it can be edited and submitted again.",
    placeholder: "Comment (optional)",
    done: "Quote reopened to Draft",
    variant: "outline",
  },
}

/**
 * The customer-outcome dialog's choices: each answer's card and the copy of
 * the dialog once it is picked (Lost needs a reason, like Mark as Lost).
 */
const OUTCOMES: Record<
  CustomerOutcome,
  { title: string; text: string } & Pick<
    TransitionCopy,
    "label" | "field" | "required" | "placeholder" | "done" | "variant"
  >
> = {
  approved: {
    title: "Won",
    text: "The customer accepted. Final: the Quote stays locked for good.",
    label: "Record as Won",
    field: "Note",
    placeholder: "Note (optional)",
    done: "Quote Won",
    variant: "default",
  },
  revise: {
    title: "Revise",
    text: "Not like this. Back to Draft, marked Rejected, to revise and resubmit.",
    label: "Revise the Quote",
    field: "Note",
    placeholder: "What the customer wants changed (optional)",
    done: "Returned to Draft for revision",
    variant: "outline",
  },
  lost: {
    title: "Lost",
    text: "The deal is dead. Only an Admin can reopen it.",
    label: "Mark as Lost",
    field: "Reason",
    required: true,
    placeholder: "Why the deal was lost",
    done: "Quote marked as lost",
    variant: "destructive",
  },
}

/** Refusals about the Quote itself, which the Owner can fix (shown on a disabled Submit). */
const FIXABLE_SUBMIT_REASONS = ["total_missing", "total_zero", "total_negative"]

/** Which transition leads when several are open: the next step forward. */
const PRIMARY_ORDER: Transition[] = [
  "approve",
  "submit",
  "markSent",
  "customerOutcome",
  "recall",
  "reopen",
]

export interface LifecycleAction {
  transition: Transition
  label: string
  icon: LucideIcon
  /** A step back or a refusal (Reject, Recall, Mark as Lost, Reopen). */
  destructive: boolean
}

/**
 * The Quote's lifecycle actions for the viewer, per `quote.permissions`:
 * Submit (the Owner; blocked with the reason when the Total isn't
 * positive), Approve / Reject (Approvers, never on their own Quote), Recall
 * (the Owner or an Admin while In Approval), Mark as Sent (the Owner or
 * an Admin while Approved; captures a Quote Document), the customer's
 * answer (the Owner or an Admin while With Customer: Won, Revise or Lost),
 * Mark as Lost (the Owner or an Admin from Draft, Approved or With
 * Customer; always secondary, with a required reason) and Reopen (Admins,
 * on a Lost Quote). The next step forward is `primary` (the header's one
 * primary button), the rest are `secondary` (its "…" menu).
 * `start(transition)` opens that transition's dialog (a comment, then the
 * command); render `dialog`.
 */
export function useLifecycleActions(quoteId: string) {
  const quote = useQuote(quoteId)
  const [open, setOpen] = useState<Transition | null>(null)
  const { permissions } = quote
  const submitDenial = permissions.submitDenial

  const shown = new Set<Transition>()
  if (permissions.canApprove) shown.add("approve")
  if (permissions.canSubmit) shown.add("submit")
  if (permissions.canMarkSent) shown.add("markSent")
  if (permissions.canRecordCustomerOutcome) shown.add("customerOutcome")
  if (permissions.canReject) shown.add("reject")
  if (permissions.canRecall) shown.add("recall")
  if (permissions.canReopen) shown.add("reopen")
  if (permissions.canMarkLost) shown.add("markLost")

  const action = (transition: Transition): LifecycleAction => ({
    transition,
    label: TRANSITIONS[transition].label,
    icon: TRANSITIONS[transition].icon,
    destructive: TRANSITIONS[transition].variant !== "default",
  })
  const lead = PRIMARY_ORDER.find((t) => shown.has(t))
  const blockedSubmit =
    !permissions.canSubmit &&
    submitDenial &&
    FIXABLE_SUBMIT_REASONS.includes(submitDenial.reason)
      ? { ...action("submit"), reason: submitDenial.message }
      : null

  return {
    primary: lead ? action(lead) : null,
    blockedSubmit: lead ? null : blockedSubmit,
    secondary: [...shown].filter((t) => t !== lead).map(action),
    start: setOpen,
    dialog: open && (
      <TransitionDialog
        quoteId={quoteId}
        transition={open}
        onOpenChange={(next) => !next && setOpen(null)}
      />
    ),
  }
}

/**
 * The header's one primary button: the next lifecycle step (outlined when
 * it is a step back, like Recall), or Submit disabled with the reason the
 * Owner can fix. Nothing when neither applies.
 */
export function LifecyclePrimaryButton({
  actions,
}: {
  actions: ReturnType<typeof useLifecycleActions>
}) {
  const { primary, blockedSubmit } = actions
  if (primary) {
    const Icon = primary.icon
    return (
      <Button
        variant={primary.destructive ? "outline" : "default"}
        onClick={() => actions.start(primary.transition)}
      >
        <Icon data-icon="inline-start" />
        {primary.label}
      </Button>
    )
  }
  if (!blockedSubmit) return null
  const Icon = blockedSubmit.icon
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} />}>
        <Button disabled>
          <Icon data-icon="inline-start" />
          {blockedSubmit.label}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{blockedSubmit.reason}</TooltipContent>
    </Tooltip>
  )
}

function useTransitionCommand(quoteId: string, transition: Transition) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const options = transitionOptions(trpc, transition)
  return useQuoteCommand(quoteId, options, {
    onSuccess: (_result, input) => {
      toast.success(
        input.outcome
          ? OUTCOMES[input.outcome].done
          : TRANSITIONS[transition].done
      )
      void queryClient.invalidateQueries(
        trpc.quote.approvalHistory.queryFilter({ id: quoteId })
      )
      void queryClient.invalidateQueries(
        trpc.quote.awaitingMyApproval.pathFilter()
      )
      if (transition === "markSent") {
        void queryClient.invalidateQueries(
          trpc.quoteDocument.list.queryFilter({ quoteId })
        )
      }
    },
  })
}

interface TransitionInput {
  id: string
  comment: string | null
  /** The customer outcome's answer. */
  outcome?: CustomerOutcome
}

/**
 * The transition's mutation, taking `{ id, comment }` whatever the command:
 * Mark as Sent's comment is its `notes`, the customer outcome's its `note`,
 * Mark as Lost's its `reason`.
 */
function transitionOptions(
  trpc: ReturnType<typeof useTRPC>,
  transition: Transition
) {
  switch (transition) {
    case "submit":
    case "approve":
    case "reject":
    case "recall":
    case "reopen":
      return adapt(
        trpc.quote[transition].mutationOptions(),
        ({ id, comment }) => ({ id, comment })
      )
    case "markLost":
      return adapt(
        trpc.quote.markLost.mutationOptions(),
        ({ id, comment }) => ({ id, reason: comment ?? "" })
      )
    case "markSent":
      return adapt(
        trpc.quote.markSent.mutationOptions(),
        ({ id, comment }) => ({
          id,
          notes: comment,
        })
      )
    case "customerOutcome":
      return adapt(
        trpc.quote.recordCustomerOutcome.mutationOptions(),
        ({ id, comment, outcome }) => ({
          id,
          outcome: outcome ?? "approved",
          note: comment,
        })
      )
  }
}

/** `options` with its variables mapped from a `TransitionInput`. */
function adapt<TData, TError, TVariables>(
  options: UseMutationOptions<TData, TError, TVariables>,
  toVariables: (input: TransitionInput) => TVariables
): UseMutationOptions<unknown, unknown, TransitionInput> {
  const { mutationKey, mutationFn } = options
  return {
    mutationKey,
    mutationFn: (input, context) => mutationFn!(toVariables(input), context),
  }
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
  const [outcome, setOutcome] = useState<CustomerOutcome>("approved")
  const command = useTransitionCommand(quoteId, transition)
  const choosing = transition === "customerOutcome"
  const copy: TransitionCopy = choosing
    ? { ...TRANSITIONS[transition], ...OUTCOMES[outcome] }
    : TRANSITIONS[transition]
  const text = comment.trim()
  const missing = Boolean(copy.required) && !text
  const confirm = () =>
    command.mutate(
      {
        id: quoteId,
        comment: text || null,
        ...(choosing ? { outcome } : {}),
      },
      { onSuccess: () => onOpenChange(false) }
    )
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        {choosing && (
          <FieldSet className="gap-1.5">
            <FieldLegend variant="label" className="mb-0">
              The customer’s answer
            </FieldLegend>
            <RadioGroup
              value={outcome}
              onValueChange={(value) => setOutcome(value as CustomerOutcome)}
            >
              {(Object.keys(OUTCOMES) as CustomerOutcome[]).map((value) => (
                <FieldLabel key={value} htmlFor={`customer-outcome-${value}`}>
                  <Field orientation="horizontal" className="items-start">
                    <FieldContent className="gap-0.5">
                      <FieldTitle>{OUTCOMES[value].title}</FieldTitle>
                      <FieldDescription className="text-xs">
                        {OUTCOMES[value].text}
                      </FieldDescription>
                    </FieldContent>
                    <RadioGroupItem
                      value={value}
                      id={`customer-outcome-${value}`}
                    />
                  </Field>
                </FieldLabel>
              ))}
            </RadioGroup>
          </FieldSet>
        )}
        <Field>
          <FieldLabel htmlFor="approval-comment">
            {copy.field ?? "Comment"}
            {copy.required && (
              <span className="font-normal text-muted-foreground">
                (required)
              </span>
            )}
          </FieldLabel>
          <Textarea
            id="approval-comment"
            value={comment}
            required={copy.required}
            maxLength={transition === "markSent" ? NOTES_MAX : COMMENT_MAX}
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
            disabled={command.isPending || missing}
            onClick={confirm}
          >
            {command.isPending ? "Working…" : copy.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
