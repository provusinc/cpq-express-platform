"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
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

import { errorMessage } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

/** The Document's notes limit (QUOTE_DOCUMENT_NOTES_MAX). */
const NOTES_MAX = 1000

/**
 * "Generate a Quote Document" (`quoteDocument.generate`, any member): renders
 * the Quote as it is now as the next version, with optional notes. The
 * toast offers the new PDF's download; the Documents list refreshes. Used
 * by the Documents tab and the Quote header's Document menu.
 */
export function GenerateDocumentDialog({
  quoteId,
  open,
  onOpenChange,
}: {
  quoteId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [notes, setNotes] = useState("")
  const generate = useMutation(
    trpc.quoteDocument.generate.mutationOptions({
      onSuccess: async (document) => {
        toast.success(`Version ${document.version} generated`, {
          action: {
            label: "Download",
            onClick: () => window.open(document.downloadUrl, "_self"),
          },
        })
        onOpenChange(false)
        setNotes("")
        await queryClient.invalidateQueries({
          queryKey: trpc.quoteDocument.list.queryKey({ quoteId }),
        })
      },
      onError: (error) => toast.error(errorMessage(error)),
    })
  )
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !generate.isPending && onOpenChange(next)}
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
            maxLength={NOTES_MAX}
            rows={3}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={generate.isPending}
            onClick={() => onOpenChange(false)}
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
  )
}
