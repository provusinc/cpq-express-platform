import {
  Building2Icon,
  ClipboardCheckIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  PackageIcon,
  SettingsIcon,
  UserCogIcon,
  UsersIcon,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import type { LabelTerm } from "@workspace/domain/enums"
import type { Labels } from "@workspace/domain/settings"

import { catalogTypeHref } from "@/lib/catalog-routes"

export interface NavItem {
  label: string
  /** Public path on the Organization's subdomain. */
  href: string
  icon: LucideIcon
  /** Shown only to Admins (the page checks the Role again). */
  adminOnly?: boolean
  /** Shown only to Approvers (the page and API check again). */
  approverOnly?: boolean
  /** The domain term the entry lists: its label is the term's plural Label Override. */
  term?: LabelTerm
  /** The icon's colour class (an item type's `navIcon` tone). */
  iconClass?: string
  /** The sidebar section the entry sits in. */
  section: NavSection
}

/** The sidebar's sections, in order (the Admin entries come last). */
export const NAV_SECTIONS = ["Quoting", "Catalog"] as const
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
    label: "Customers",
    href: "/customers",
    icon: Building2Icon,
    section: "Quoting",
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

/** A Catalog Type's entry: its plural name, in its colour. */
export interface CatalogTypeNavFacts {
  id: string
  plural: string
  iconClass: string
}

/**
 * `items` as the Organization sees them: relabelled by Label Overrides,
 * with one entry per active Catalog Type (in order) at the top of the
 * Catalog section, before Resource Roles.
 */
export function labelNavItems(
  items: NavItem[],
  labels: Labels,
  catalogTypes: readonly CatalogTypeNavFacts[],
  labourIconClass?: string
): NavItem[] {
  const typeItems: NavItem[] = catalogTypes.map((type) => ({
    label: type.plural,
    href: catalogTypeHref(type.id),
    icon: PackageIcon,
    iconClass: type.iconClass,
    section: "Catalog",
  }))
  return items.flatMap((item) => {
    if (!item.term) return [item]
    const entry = {
      ...item,
      label: labels[item.term].plural,
      iconClass: item.term === "resource_role" ? labourIconClass : undefined,
    }
    return item.term === "resource_role" ? [...typeItems, entry] : [entry]
  })
}
