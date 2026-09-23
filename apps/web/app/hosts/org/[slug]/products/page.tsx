import type { Metadata } from "next"

import { PlaceholderPage } from "@/components/shell/placeholder-page"

export const metadata: Metadata = { title: "Products · CPQ Express" }

export default function ProductsPage() {
  return (
    <PlaceholderPage
      title="Products"
      description="Catalog Items sold per unit."
    />
  )
}
