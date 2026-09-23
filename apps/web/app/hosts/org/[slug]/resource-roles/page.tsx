import type { Metadata } from "next"

import { PlaceholderPage } from "@/components/shell/placeholder-page"

export const metadata: Metadata = { title: "Resource Roles · CPQ Express" }

export default function ResourceRolesPage() {
  return (
    <PlaceholderPage
      title="Resource Roles"
      description="Kinds of labour you sell by the hour."
    />
  )
}
