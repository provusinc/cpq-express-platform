import {
  Building2Icon,
  FileTextIcon,
  PackageIcon,
  PackagePlusIcon,
  SettingsIcon,
  UserCogIcon,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

export interface NavItem {
  label: string
  /** Public path on the Organization's subdomain. */
  href: string
  icon: LucideIcon
  /** Shown only to Admins (the page checks the Role again). */
  adminOnly?: boolean
}

/**
 * The Organization shell's navigation, one entry per feature area. Each
 * `href` has a page under `app/hosts/org/[slug]/`.
 */
export const NAV_ITEMS: NavItem[] = [
  { label: "Quotes", href: "/quotes", icon: FileTextIcon },
  { label: "Accounts", href: "/accounts", icon: Building2Icon },
  { label: "Products", href: "/products", icon: PackageIcon },
  { label: "Add-ons", href: "/add-ons", icon: PackagePlusIcon },
  { label: "Resource Roles", href: "/resource-roles", icon: UserCogIcon },
]

export const SETTINGS_NAV_ITEM: NavItem = {
  label: "Settings",
  href: "/settings",
  icon: SettingsIcon,
  adminOnly: true,
}
