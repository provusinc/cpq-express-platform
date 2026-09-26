import {
  Building2Icon,
  FileTextIcon,
  ListChecksIcon,
  SlidersHorizontalIcon,
  TagsIcon,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

/**
 * The Settings sections, in order (the side nav). Each has a route at
 * `app/hosts/org/[slug]/settings/<segment>/page.tsx`; add one by adding
 * its entry here and its page.
 */
export const SETTINGS_TABS = [
  {
    segment: "profile",
    label: "Organization profile",
    description: "Name, logo and address",
    href: "/settings/profile",
    icon: Building2Icon,
  },
  {
    segment: "quoting",
    label: "Quoting",
    description: "Working hours and deletion rules",
    href: "/settings/quoting",
    icon: SlidersHorizontalIcon,
  },
  {
    segment: "statuses",
    label: "Quote Statuses",
    description: "Your steps inside each Stage",
    href: "/settings/statuses",
    icon: ListChecksIcon,
  },
  {
    segment: "labels",
    label: "Labels",
    description: "What your team calls things",
    href: "/settings/labels",
    icon: TagsIcon,
  },
  {
    segment: "documents",
    label: "Documents",
    description: "How Quote Documents print",
    href: "/settings/documents",
    icon: FileTextIcon,
  },
] as const satisfies readonly {
  segment: string
  label: string
  description: string
  href: string
  icon: LucideIcon
}[]
