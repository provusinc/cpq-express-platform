"use client"

import { PDFViewer } from "@react-pdf/renderer"

import { QuoteDocument } from "@workspace/documents"
import type { QuoteDocumentInput } from "@workspace/documents"

/**
 * The live preview: the same `QuoteDocument` the server renders, drawn in
 * the browser by react-pdf. Browser only — load it with
 * `next/dynamic(…, { ssr: false })` (see `documents-tab.tsx`).
 */
export default function DocumentPreview({
  input,
}: {
  input: QuoteDocumentInput
}) {
  return (
    <PDFViewer
      width="100%"
      height="100%"
      showToolbar
      className="h-full w-full rounded-lg border bg-muted"
    >
      <QuoteDocument {...input} />
    </PDFViewer>
  )
}
