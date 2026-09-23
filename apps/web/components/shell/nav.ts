import {
  Building2Icon,
  ClipboardCheckIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  PackageIcon,
  PackagePlusIcon,
  SettingsIcon,
  UserCogIcon,
  UsersIcon,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import type { LabelTerm } from "@workspace/domain/enums"
import type { Labels } from "@workspace/domain/settings"

export interface NavItem {
  label: string
  /** Public path on the Organization's subdomain. */
  href: string
  icon: LucideIcon
  /** Shown only to Admins (the page checks the Role again). */
  adminOnly?: boolean
  /** Shown only to Approvers (the page and API check again). */
  approverOnly?: boolean
  /**
   * The domain term the entry lists: its label is the term's plural Label
   * Override, and a hidden term (Products, Add-ons) hides the entry.
   */
  term?: LabelTerm
  /** The sidebar section the entry sits in. */
  section: NavSection
}

/** The sidebar's sections, in order (the Admin entries come last). */
export const NAV_SECTIONS = ["Quoting", "Customers", "Catalog"] as const
export type NavSection = (typeof NAV_SECTIONS)[number] | "Organization"

/**
 * The Organization shell's navigation, one entry per feature area. Each
 * `href` has a page under `app/hosts/org/[slug]/`.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    label: "Dashboard",
    href: "/",
    icon: LayoutDashboardIcon,
    section: "Quoting",
  },
  { label: "Quotes", href: "/quotes", icon: FileTextIcon, section: "Quoting" },
  {
    label: "Awaiting my approval",
    href: "/approvals",
    icon: ClipboardCheckIcon,
    approverOnly: true,
    section: "Quoting",
  },
  {
    label: "Accounts",
    href: "/accounts",
    icon: Building2Icon,
    section: "Customers",
  },
  {
    label: "Products",
    href: "/products",
    icon: PackageIcon,
    term: "product",
    section: "Catalog",
  },
  {
    label: "Add-ons",
    href: "/add-ons",
    icon: PackagePlusIcon,
    term: "add_on",
    section: "Catalog",
  },
  {
    label: "Resource Roles",
    href: "/resource-roles",
    icon: UserCogIcon,
    term: "resource_role",
    section: "Catalog",
  },
]

/** The Admin-only entries at the bottom of the sidebar. */
export const ADMIN_NAV_ITEMS: NavItem[] = [
  {
    label: "Members",
    href: "/members",
    icon: UsersIcon,
    adminOnly: true,
    section: "Organization",
  },
  {
    label: "Settings",
    href: "/settings",
    icon: SettingsIcon,
    adminOnly: true,
    section: "Organization",
  },
]

/** `items` as the Organization sees them: relabelled, hidden terms left out. */
export function labelNavItems(items: NavItem[], labels: Labels): NavItem[] {
  return items.flatMap((item) => {
    if (!item.term) return [item]
    const label = labels[item.term]
    return label.enabled ? [{ ...item, label: label.plural }] : []
  })
}
