"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CopyIcon, EllipsisIcon, Trash2Icon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import { ConfirmDialog } from "@/components/shell/confirm-dialog"
import { errorMessage } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

import type { CloneSource } from "./clone-quote-dialog"
import { CloneQuoteDialog } from "./clone-quote-dialog"

/**
 * "Delete Quote?" for one Quote (`quote.delete`): permanent, with
 * everything on it. `onDeleted` runs after the list caches are refreshed
 * (the editor navigates back to the list).
 */
export function DeleteQuoteDialog({
  open,
  onOpenChange,
  quote,
  onDeleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  quote: { id: string; name: string }
  onDeleted?: () => void
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const remove = useMutation(
    trpc.quote.delete.mutationOptions({
      onSuccess: async (deleted) => {
        toast.success(`Quote “${deleted.name}” deleted.`)
        onOpenChange(false)
        onDeleted?.()
        await queryClient.invalidateQueries(trpc.quote.list.pathFilter())
        await queryClient.invalidateQueries(
          trpc.quote.filterOptions.pathFilter()
        )
      },
      onError: (error) => toast.error(errorMessage(error)),
    })
  )
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete “${quote.name}”?`}
      description="The Quote and everything on it (Line Items, plan, Milestones, approval history and Quote Documents) are deleted permanently. This can't be undone."
      confirmLabel="Delete Quote"
      pending={remove.isPending}
      onConfirm={() => remove.mutate({ id: quote.id })}
    />
  )
}

/**
 * The Quote editor header's own actions: Clone (any member) and, in the
 * menu, Delete when `canDelete` (Owner or Admin, deletable status).
 */
export function QuoteHeaderActions({
  quote,
  canDelete,
}: {
  quote: CloneSource
  canDelete: boolean
}) {
  const router = useRouter()
  const [cloning, setCloning] = useState(false)
  const [deleting, setDeleting] = useState(false)
  return (
    <>
      <Button variant="outline" onClick={() => setCloning(true)}>
        <CopyIcon data-icon="inline-start" />
        Clone
      </Button>
      {canDelete && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" aria-label="More actions" />
            }
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setDeleting(true)}
            >
              <Trash2Icon />
              Delete Quote
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <CloneQuoteDialog
        open={cloning}
        onOpenChange={setCloning}
        source={quote}
      />
      <DeleteQuoteDialog
        open={deleting}
        onOpenChange={setDeleting}
        quote={quote}
        onDeleted={() => router.push("/quotes")}
      />
    </>
  )
}
