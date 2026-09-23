import type { Metadata } from "next"

import { PlaceholderPage } from "@/components/shell/placeholder-page"

export const metadata: Metadata = { title: "Accounts · CPQ Express" }

export default function AccountsPage() {
  return (
    <PlaceholderPage
      title="Accounts"
      description="The companies you quote, and their Contacts."
    />
  )
}
