import type { Metadata } from "next"

import { PlaceholderPage } from "@/components/shell/placeholder-page"

export const metadata: Metadata = { title: "Add-ons · CPQ Express" }

export default function AddOnsPage() {
  return (
    <PlaceholderPage
      title="Add-ons"
      description="Catalog Items sold per unit or per hour."
    />
  )
}
