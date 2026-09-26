"use client"

import { createContext, useContext, useMemo } from "react"

import { useActiveCatalogTypes } from "./catalog-types"
import { useLabels } from "./labels"
import { ADMIN_NAV_ITEMS, labelNavItems, NAV_ITEMS } from "./nav"
import type { NavItem } from "./nav"
import { catalogTypeTone, LABOUR_TONE } from "./tints"
import type { ShellOrganization } from "./types"

interface Shell {
  organization: ShellOrganization
  isAdmin: boolean
  isApprover: boolean
  /** Opens the New Quote dialog from anywhere in the shell. */
  newQuote: () => void
  /** Opens the command menu (⌘K). */
  openCommandMenu: () => void
}

const ShellContext = createContext<Shell | null>(null)

export const ShellProvider = ShellContext

/** The shell's Organization, the caller's Role facts and the global actions. */
export function useShell(): Shell {
  const shell = useContext(ShellContext)
  if (!shell) throw new Error("useShell() outside the app shell")
  return shell
}

/**
 * The navigation the caller sees: Approver-only entries for Approvers,
 * Admin entries for Admins, relabelled per Label Overrides, and one entry
 * per active Catalog Type in its colour.
 */
export function useNavItems(): NavItem[] {
  const { isAdmin, isApprover } = useShell()
  const labels = useLabels()
  const catalogTypes = useActiveCatalogTypes()
  return useMemo(
    () => [
      ...labelNavItems(
        NAV_ITEMS.filter((item) => !item.approverOnly || isApprover),
        labels,
        catalogTypes.map((type) => ({
          id: type.id,
          plural: type.plural,
          iconClass: catalogTypeTone(type.colourIndex).navIcon,
        })),
        LABOUR_TONE.navIcon
      ),
      ...(isAdmin ? ADMIN_NAV_ITEMS : []),
    ],
    [isAdmin, isApprover, labels, catalogTypes]
  )
}
