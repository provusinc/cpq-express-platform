/**
 * The Quote editor's tabs, in order. Each is a route under
 * `app/hosts/org/[slug]/quotes/[quoteId]/` (`segment` null = the index
 * route, Overview); the header above them is the layout.
 */
export const QUOTE_TABS = [
  { segment: null, label: "Overview", path: "" },
  { segment: "line-items", label: "Line Items", path: "/line-items" },
  { segment: "planner", label: "Resource Planner", path: "/planner" },
  { segment: "timeline", label: "Timeline", path: "/timeline" },
  { segment: "financials", label: "Financials", path: "/financials" },
  { segment: "documents", label: "Documents", path: "/documents" },
] as const satisfies readonly {
  segment: string | null
  label: string
  path: string
}[]

export type QuoteTab = (typeof QUOTE_TABS)[number]
