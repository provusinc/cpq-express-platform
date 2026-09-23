import { QuoteTabPlaceholder } from "@/components/quotes/quote-tab-placeholder"
import { getLabels } from "@/components/shell/get-labels"

export default async function QuoteTimelinePage() {
  const labels = await getLabels()
  return (
    <QuoteTabPlaceholder
      title="The Timeline"
      description={`Line Items as bars by ${labels.phase.singular}, with Milestones.`}
    />
  )
}
