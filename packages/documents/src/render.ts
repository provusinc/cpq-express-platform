/**
 * Server rendering of the Quote Document (Node only: react-pdf's
 * `renderToBuffer`). Import from `@workspace/documents/server`.
 */
import { renderToBuffer } from "@react-pdf/renderer"
import type { DocumentProps } from "@react-pdf/renderer"
import { createElement } from "react"
import type { ReactElement } from "react"

import { QuoteDocument } from "./quote-document"
import type { QuoteDocumentInput } from "./snapshot"

/** Renders the Quote Document to PDF bytes (they start with `%PDF-`). */
export async function renderQuoteDocument(
  input: QuoteDocumentInput
): Promise<Buffer> {
  // QuoteDocument returns a <Document>, which is what react-pdf renders.
  const document = createElement(
    QuoteDocument,
    input
  ) as unknown as ReactElement<DocumentProps>
  return renderToBuffer(document)
}
