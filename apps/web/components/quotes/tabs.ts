/**
 * The Quote editor's tabs, in order. Each is a route under
 * `app/hosts/org/[slug]/quotes/[quoteId]/` (`segment` null = the index
 * route); the header above them is the layout. A ticket that builds a tab
 * replaces its `QuoteTabPlaceholder` page.
 */
export const QUOTE_TABS = [
  { segment: null, label: "Line Items", path: "" },
  { segment: "planner", label: "Resource Planner", path: "/planner" },
  { segment: "timeline", label: "Timeline", path: "/timeline" },
  { segment: "summary", label: "Summary", path: "/summary" },
  { segment: "financials", label: "Financials", path: "/financials" },
  { segment: "documents", label: "Documents", path: "/documents" },
] as const satisfies readonly {
  segment: string | null
  label: string
  path: string
}[]

export type QuoteTab = (typeof QUOTE_TABS)[number]
