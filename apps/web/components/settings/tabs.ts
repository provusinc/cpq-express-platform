/**
 * The Settings tabs, in order. Each has a route at
 * `app/hosts/org/[slug]/settings/<segment>/page.tsx`; add a tab by adding
 * its entry here and its page.
 */
export const SETTINGS_TABS = [
  { segment: "company", label: "Company", href: "/settings/company" },
  { segment: "quoting", label: "Quoting", href: "/settings/quoting" },
  { segment: "labels", label: "Labels", href: "/settings/labels" },
  { segment: "documents", label: "Documents", href: "/settings/documents" },
] as const satisfies readonly {
  segment: string
  label: string
  href: string
}[]
