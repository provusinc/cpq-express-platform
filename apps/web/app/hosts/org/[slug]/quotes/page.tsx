import type { Metadata } from "next"

import { PlaceholderPage } from "@/components/shell/placeholder-page"

export const metadata: Metadata = { title: "Quotes · CPQ Express" }

export default function QuotesPage() {
  return (
    <PlaceholderPage
      title="Quotes"
      description="Priced engagements offered to your Accounts."
    />
  )
}
