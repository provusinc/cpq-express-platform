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
import { createContext, useContext, useState } from "react"
import { toast } from "sonner"

import type { RouterOutputs } from "@workspace/api"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  RowMenuItem,
  RowMenuSeparator,
  useDataTableRow,
} from "@workspace/ui/components/niko-table/components/data-table-row-menu"
import type { DataTableColumns } from "@workspace/ui/components/niko-table/types"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { ConfirmDialog } from "@/components/shell/confirm-dialog"
import {
  ColumnTitle,
  ListTable,
  LocalTableRoot,
} from "@/components/shell/data-table"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/shell/empty"
import { formatDate } from "@/lib/format"
import { errorMessage } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

import { GenerateDocumentDialog } from "./generate-document-dialog"

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
  const [deleting, setDeleting] = useState<QuoteDocumentItem | null>(null)

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
        <DocumentActionsContext value={{ onDelete: setDeleting }}>
          <LocalTableRoot
            columns={documentColumns}
            data={documents.data}
            isLoading={!documents.data}
          >
            <ListTable
              rowMenu={DocumentRowMenu}
              skeletonRows={2}
              empty={{
                icon: <FileTextIcon />,
                title: "No Quote Documents yet",
                description:
                  "Generate one to keep a PDF of the Quote as it is now.",
              }}
            />
          </LocalTableRoot>
        </DocumentActionsContext>
      </section>

      <GenerateDocumentDialog
        quoteId={quoteId}
        open={generating}
        onOpenChange={setGenerating}
      />

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

/** The list's delete action, provided by the tab (columns are module-level). */
const DocumentActionsContext = createContext<{
  onDelete: (document: QuoteDocumentItem) => void
} | null>(null)

type DocumentCell = { row: { original: QuoteDocumentItem } }

function VersionCell({ row }: DocumentCell) {
  const document = row.original
  const generatedAt = new Date(document.generatedAt)
  return (
    <div className="flex flex-col gap-1 text-sm whitespace-normal">
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
    </div>
  )
}

function DocumentButtonsCell({ row }: DocumentCell) {
  const { onDelete } = useContext(DocumentActionsContext)!
  const document = row.original
  return (
    <div className="flex items-center justify-end gap-1">
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
        render={<a href={document.downloadUrl} download={document.fileName} />}
      >
        <DownloadIcon data-icon="inline-start" />
        Download
      </Button>
      {document.canDelete && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete version ${document.version}`}
          onClick={() => onDelete(document)}
        >
          <Trash2Icon />
        </Button>
      )}
    </div>
  )
}

/** A Quote Document's right-click menu: open, download, delete. */
function DocumentRowMenu() {
  const { onDelete } = useContext(DocumentActionsContext)!
  const document = useDataTableRow<QuoteDocumentItem>()
  return (
    <>
      <RowMenuItem
        render={
          <a
            href={`${document.downloadUrl}?inline=1`}
            target="_blank"
            rel="noreferrer"
          />
        }
      >
        <ExternalLinkIcon />
        Open
      </RowMenuItem>
      <RowMenuItem
        render={<a href={document.downloadUrl} download={document.fileName} />}
      >
        <DownloadIcon />
        Download
      </RowMenuItem>
      {document.canDelete && (
        <>
          <RowMenuSeparator />
          <RowMenuItem variant="destructive" onClick={() => onDelete(document)}>
            <Trash2Icon />
            Delete
          </RowMenuItem>
        </>
      )}
    </>
  )
}

/** Newest first, as `quoteDocument.list` returns them. */
const documentColumns: DataTableColumns<QuoteDocumentItem> = [
  {
    id: "version",
    accessorKey: "version",
    header: ColumnTitle,
    meta: { label: "Version" },
    cell: VersionCell,
  },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: DocumentButtonsCell,
  },
]
