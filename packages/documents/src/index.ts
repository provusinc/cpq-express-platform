/**
 * @workspace/documents — the Quote Document as `@react-pdf/renderer`
 * components, shared by the browser preview and server rendering.
 *
 * - `QuoteDocument({ snapshot, settings, logo })`: the `<Document>` tree.
 *   The browser previews it with react-pdf's `PDFViewer` / `usePDF`; the
 *   server renders it with `renderQuoteDocument` from
 *   `@workspace/documents/server` (Node only).
 * - `QuoteDocumentSnapshot` / `QuoteDocumentInput`: the plain, serialisable
 *   render input (built by the API, stored with every Quote Document).
 * - Formatting (`formatDocumentMoney`, …) and `groupLinesByPhase`.
 */
export { QuoteDocument } from "./quote-document"
export type { QuoteDocumentInput, QuoteDocumentSnapshot } from "./snapshot"
export {
  formatDocumentDate,
  formatDocumentMoney,
  formatDocumentPercent,
  formatDocumentQuantity,
  isPdfPrintable,
  pdfText,
} from "./format"
export { groupLinesByPhase } from "./grouping"
export type { LineGroups, PhaseGroup } from "./grouping"
