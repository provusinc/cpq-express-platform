"use client"

import { useQueryClient } from "@tanstack/react-query"
import { ChevronDownIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { QUOTE_STAGE_LABELS } from "@workspace/domain/enums"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/trpc/react"

import { useQuoteCommand } from "./autosave"
import { QuoteStatusBadge } from "./quote-status-badge"
import type { Quote } from "./use-quote"

/** The longest comment the API accepts (APPROVAL_COMMENT_MAX). */
const COMMENT_MAX = 2000

type StageStatus = Quote["stageStatuses"][number]

/**
 * The Quote header's Status badge. When the Quote's Stage has more than one
 * Status and the viewer may move it (`permissions.canSetStatus`: editors in
 * Draft, Approvers In Approval, the Owner or an Admin in Approved and With
 * Customer, Admins in Won and Lost), the badge opens a menu of the Stage's
 * Statuses; picking one asks for an optional comment, then
 * `quote.setStatus` records a status change. Otherwise it is the plain
 * badge. Moving between Statuses never changes the Stage.
 */
export function QuoteStatusMenu({
  quote,
  className,
}: {
  quote: Quote
  className?: string
}) {
  const [moving, setMoving] = useState<StageStatus | null>(null)
  const badge = (
    <QuoteStatusBadge
      stage={quote.stage}
      status={quote.status}
      rejected={quote.rejected}
    />
  )
  if (!quote.permissions.canSetStatus || quote.stageStatuses.length < 2) {
    return <span className={className}>{badge}</span>
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "inline-flex items-center gap-0.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            className
          )}
          aria-label={`Status: ${quote.status.name}. Change Status`}
        >
          {badge}
          <ChevronDownIcon
            className="size-3.5 text-muted-foreground"
            aria-hidden
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              {QUOTE_STAGE_LABELS[quote.stage]} Statuses
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={quote.status.id}
              onValueChange={(id) => {
                const target = quote.stageStatuses.find((s) => s.id === id)
                if (target && target.id !== quote.status.id) setMoving(target)
              }}
            >
              {quote.stageStatuses.map((status) => (
                <DropdownMenuRadioItem
                  key={status.id}
                  value={status.id}
                  closeOnClick
                >
                  <QuoteStatusBadge stage={quote.stage} status={status} />
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {moving && (
        <SetStatusDialog
          quote={quote}
          target={moving}
          onOpenChange={(open) => !open && setMoving(null)}
        />
      )}
    </>
  )
}

/** Confirms a status change with an optional comment. */
function SetStatusDialog({
  quote,
  target,
  onOpenChange,
}: {
  quote: Quote
  target: StageStatus
  onOpenChange: (open: boolean) => void
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [comment, setComment] = useState("")
  const setStatus = useQuoteCommand(
    quote.id,
    trpc.quote.setStatus.mutationOptions(),
    {
      onSuccess: (result) => {
        toast.success(`Moved to ${result.status.name}`)
        void queryClient.invalidateQueries(
          trpc.quote.approvalHistory.queryFilter({ id: quote.id })
        )
      },
    }
  )
  const confirm = () =>
    setStatus.mutate(
      {
        id: quote.id,
        statusId: target.id,
        comment: comment.trim() || null,
      },
      { onSuccess: () => onOpenChange(false) }
    )
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move to {target.name}</DialogTitle>
          <DialogDescription>
            From {quote.status.name} to {target.name}. The Quote stays in{" "}
            {QUOTE_STAGE_LABELS[quote.stage]}; the change is recorded in its
            approval history.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="status-change-comment">Comment</FieldLabel>
          <Textarea
            id="status-change-comment"
            value={comment}
            maxLength={COMMENT_MAX}
            placeholder="Comment (optional)"
            onChange={(event) => setComment(event.target.value)}
            rows={3}
          />
        </Field>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={setStatus.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button disabled={setStatus.isPending} onClick={confirm}>
            {setStatus.isPending ? "Moving…" : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
