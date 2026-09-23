"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  LockIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react"
import dynamic from "next/dynamic"
import { useState } from "react"
import { toast } from "sonner"

import type { RouterOutputs } from "@workspace/api"
import { Badge } from "@workspace/ui/components/badge"
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Textarea } from "@workspace/ui/components/textarea"

import { ConfirmDialog } from "@/components/shell/confirm-dialog"
import { formatDate } from "@/lib/format"
import { errorMessage } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

type QuoteDocumentItem = RouterOutputs["quoteDocument"]["list"][number]

// react-pdf draws in the browser only.
const DocumentPreview = dynamic(() => import("./document-preview"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full" />,
})

/** "24.3 KB". */
function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const TIME = new Intl.DateTimeFormat("en", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
})

/**
 * The Quote editor's Documents tab: a live preview of the Quote Document as
 * the Quote stands now (rendered in the browser from the same components
 * the server uses), and the generated Quote Documents, newest first, to
 * open, download or (Owner or Admin, never one captured by Mark as Sent)
 * delete. Any member may generate a new version.
 */
export function DocumentsTab({ quoteId }: { quoteId: string }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const preview = useQuery({
    ...trpc.quoteDocument.previewSnapshot.queryOptions({ quoteId }),
    refetchOnWindowFocus: true,
  })
  const documents = useQuery(trpc.quoteDocument.list.queryOptions({ quoteId }))
  const [generating, setGenerating] = useState(false)
  const [notes, setNotes] = useState("")
  const [deleting, setDeleting] = useState<QuoteDocumentItem | null>(null)

  const generate = useMutation(
    trpc.quoteDocument.generate.mutationOptions({
      onSuccess: async (document) => {
        toast.success(`Version ${document.version} generated`)
        setGenerating(false)
        setNotes("")
        await queryClient.invalidateQueries({
          queryKey: trpc.quoteDocument.list.queryKey({ quoteId }),
        })
      },
      onError: (error) => toast.error(errorMessage(error)),
    })
  )
  const remove = useMutation(
    trpc.quoteDocument.delete.mutationOptions({
      onSuccess: async () => {
        toast.success(`Version ${deleting?.version} deleted`)
        setDeleting(null)
        await queryClient.invalidateQueries({
          queryKey: trpc.quoteDocument.list.queryKey({ quoteId }),
        })
      },
      onError: (error) => toast.error(errorMessage(error)),
    })
  )

  return (
    <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-start">
      <section className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Live preview</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => preview.refetch()}
            disabled={preview.isFetching}
          >
            <RefreshCwIcon data-icon="inline-start" />
            Refresh
          </Button>
        </div>
        <div className="h-[75vh] min-h-[480px]">
          {preview.data ? (
            <DocumentPreview input={preview.data} />
          ) : preview.error ? (
            <Empty className="h-full border">
              <EmptyHeader>
                <EmptyTitle>The preview couldn&apos;t load</EmptyTitle>
                <EmptyDescription>
                  {errorMessage(preview.error)}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Skeleton className="h-full w-full" />
          )}
        </div>
      </section>

      <section className="flex w-full flex-col gap-3 xl:w-96">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Quote Documents</h2>
          <Button onClick={() => setGenerating(true)}>
            <FileTextIcon data-icon="inline-start" />
            Generate
          </Button>
        </div>
        {documents.data?.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileTextIcon />
              </EmptyMedia>
              <EmptyTitle>No Quote Documents yet</EmptyTitle>
              <EmptyDescription>
                Generate one to keep a PDF of the Quote as it is now.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {(documents.data ?? []).map((document) => (
              <DocumentRow
                key={document.id}
                document={document}
                onDelete={() => setDeleting(document)}
              />
            ))}
            {!documents.data &&
              [0, 1].map((i) => (
                <li key={i} className="p-3">
                  <Skeleton className="h-10 w-full" />
                </li>
              ))}
          </ul>
        )}
      </section>

      <Dialog
        open={generating}
        onOpenChange={(open) => !generate.isPending && setGenerating(open)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate a Quote Document</DialogTitle>
            <DialogDescription>
              Renders the Quote as it is now and keeps it as the next version,
              with the settings it used. It can&apos;t be changed later.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="document-notes">Notes (optional)</FieldLabel>
            <Textarea
              id="document-notes"
              value={notes}
              maxLength={1000}
              rows={3}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={generate.isPending}
              onClick={() => setGenerating(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={generate.isPending}
              onClick={() => generate.mutate({ quoteId, notes })}
            >
              {generate.isPending ? "Generating…" : "Generate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete version ${deleting?.version}?`}
        description="The PDF is removed for good. Other versions keep their numbers."
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate({ id: deleting.id })}
      />
    </div>
  )
}

function DocumentRow({
  document,
  onDelete,
}: {
  document: QuoteDocumentItem
  onDelete: () => void
}) {
  const generatedAt = new Date(document.generatedAt)
  return (
    <li className="flex flex-col gap-1.5 p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-medium">Version {document.version}</span>
        {document.capturedByMarkSent && (
          <Badge variant="secondary">
            <LockIcon data-icon="inline-start" />
            Sent
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {formatSize(document.fileSize)}
        </span>
      </div>
      <div className="text-xs text-muted-foreground">
        {formatDate(generatedAt)} {TIME.format(generatedAt)} UTC ·{" "}
        {document.generatedBy.name ?? document.generatedBy.email}
      </div>
      {document.notes && (
        <p className="text-xs whitespace-pre-wrap">{document.notes}</p>
      )}
      <div className="flex flex-wrap gap-1">
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={
            <a
              href={`${document.downloadUrl}?inline=1`}
              target="_blank"
              rel="noreferrer"
            />
          }
        >
          <ExternalLinkIcon data-icon="inline-start" />
          Open
        </Button>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={
            <a href={document.downloadUrl} download={document.fileName} />
          }
        >
          <DownloadIcon data-icon="inline-start" />
          Download
        </Button>
        {document.canDelete && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            aria-label={`Delete version ${document.version}`}
            onClick={onDelete}
          >
            <Trash2Icon />
          </Button>
        )}
      </div>
    </li>
  )
}
