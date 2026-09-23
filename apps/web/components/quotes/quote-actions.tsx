"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ChevronDownIcon,
  CopyIcon,
  DownloadIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  FilePlusIcon,
  FilesIcon,
  FileTextIcon,
  Trash2Icon,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import {
  LifecyclePrimaryButton,
  useLifecycleActions,
} from "@/components/approval/approval-actions"
import { GenerateDocumentDialog } from "@/components/documents/generate-document-dialog"
import { ConfirmDialog } from "@/components/shell/confirm-dialog"
import { errorMessage } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

import { CloneQuoteDialog } from "./clone-quote-dialog"
import type { Quote } from "./use-quote"

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
        await queryClient.invalidateQueries(trpc.quote.insights.pathFilter())
        await queryClient.invalidateQueries(trpc.dashboard.pathFilter())
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
 * The Quote header's actions, left to right: Clone (any member), the
 * Document menu, the one primary button for the next lifecycle step
 * (`useLifecycleActions`) and the "…" menu with the other lifecycle actions
 * and Delete (when `canDelete`: Owner or Admin, deletable status).
 */
export function QuoteHeaderActions({ quote }: { quote: Quote }) {
  const router = useRouter()
  const lifecycle = useLifecycleActions(quote.id)
  const [cloning, setCloning] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const canDelete = quote.permissions.canDelete
  const hasMenu = lifecycle.secondary.length > 0 || canDelete
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" onClick={() => setCloning(true)}>
        <CopyIcon data-icon="inline-start" />
        Clone
      </Button>
      <DocumentMenu quoteId={quote.id} />
      <LifecyclePrimaryButton actions={lifecycle} />
      {hasMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" aria-label="More actions" />
            }
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {lifecycle.secondary.map((action) => {
              const Icon = action.icon
              return (
                <DropdownMenuItem
                  key={action.transition}
                  onClick={() => lifecycle.start(action.transition)}
                >
                  <Icon />
                  {action.label}
                </DropdownMenuItem>
              )
            })}
            {lifecycle.secondary.length > 0 && canDelete && (
              <DropdownMenuSeparator />
            )}
            {canDelete && (
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDeleting(true)}
              >
                <Trash2Icon />
                Delete Quote
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {lifecycle.dialog}
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
    </div>
  )
}

/**
 * "Document": generate a new Quote Document (any member, also on a locked
 * Quote), download or open the latest version, or go to the Documents tab.
 * The list is read only while the menu is open.
 */
function DocumentMenu({ quoteId }: { quoteId: string }) {
  const [generating, setGenerating] = useState(false)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" />}>
          <FileTextIcon data-icon="inline-start" />
          Document
          <ChevronDownIcon data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem onClick={() => setGenerating(true)}>
            <FilePlusIcon />
            Generate Document…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <LatestDocumentItems quoteId={quoteId} />
          <DropdownMenuItem
            render={<Link href={`/quotes/${quoteId}/documents`} />}
          >
            <FilesIcon />
            All Quote Documents
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <GenerateDocumentDialog
        quoteId={quoteId}
        open={generating}
        onOpenChange={setGenerating}
      />
    </>
  )
}

/** The latest Quote Document's download and open (mounted with the menu). */
function LatestDocumentItems({ quoteId }: { quoteId: string }) {
  const trpc = useTRPC()
  const documents = useQuery(trpc.quoteDocument.list.queryOptions({ quoteId }))
  const latest = documents.data?.[0]
  if (!latest) {
    return (
      <DropdownMenuItem disabled>
        <DownloadIcon />
        {documents.isPending ? "Loading…" : "No Quote Documents yet"}
      </DropdownMenuItem>
    )
  }
  return (
    <>
      <DropdownMenuItem
        render={<a href={latest.downloadUrl} download={latest.fileName} />}
      >
        <DownloadIcon />
        Download version {latest.version}
      </DropdownMenuItem>
      <DropdownMenuItem
        render={
          <a
            href={`${latest.downloadUrl}?inline=1`}
            target="_blank"
            rel="noreferrer"
          />
        }
      >
        <ExternalLinkIcon />
        Open version {latest.version}
      </DropdownMenuItem>
    </>
  )
}
