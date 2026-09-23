import { QuoteTabPlaceholder } from "@/components/quotes/quote-tab-placeholder"
import { getLabels } from "@/components/shell/get-labels"

export default async function QuoteLineItemsPage() {
  const labels = await getLabels()
  const sellables = (["product", "add_on", "resource_role"] as const)
    .filter((term) => labels[term].enabled)
    .map((term) => labels[term].plural)
  const list =
    sellables.length > 1
      ? `${sellables.slice(0, -1).join(", ")} and ${sellables.at(-1)}`
      : (sellables[0] ?? "items")
  return (
    <QuoteTabPlaceholder
      title="Line Items"
      description={`Add ${list} and edit them in place.`}
    />
  )
}
