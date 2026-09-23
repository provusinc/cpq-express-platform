/**
 * The Settings tabs, in order. Each has a route at
 * `app/hosts/org/[slug]/settings/<segment>/page.tsx`; add a tab (e.g.
 * Documents, #21) by adding its entry here and its page.
 */
export const SETTINGS_TABS = [
  { segment: "company", label: "Company", href: "/settings/company" },
  { segment: "quoting", label: "Quoting", href: "/settings/quoting" },
  { segment: "labels", label: "Labels", href: "/settings/labels" },
] as const satisfies readonly {
  segment: string
  label: string
  href: string
}[]
