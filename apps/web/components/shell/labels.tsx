"use client"

import { createContext, useContext } from "react"

import { resolveLabels } from "@workspace/domain/settings"
import type { Labels } from "@workspace/domain/settings"

const LabelsContext = createContext<Labels>(resolveLabels())

/**
 * Provides the Organization's labels (Label Overrides over the canonical
 * names) to client components. The Organization layout loads them on the
 * server (`settings.labels`) and passes them in through the app shell.
 */
export function LabelsProvider({
  labels,
  children,
}: {
  labels: Labels
  children: React.ReactNode
}) {
  return <LabelsContext value={labels}>{children}</LabelsContext>
}

/**
 * The display names for domain terms in UI copy:
 * `useLabels().resource_role.plural` → "Consultants" (or "Resource Roles").
 * `enabled` is false for a hidden Product or Add-on term. Code, routes and
 * API keep the canonical terms; only wording changes.
 */
export function useLabels(): Labels {
  return useContext(LabelsContext)
}
