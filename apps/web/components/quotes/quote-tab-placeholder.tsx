import { ConstructionIcon } from "lucide-react"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

/** Stand-in for a Quote editor tab that a later ticket builds. */
export function QuoteTabPlaceholder({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ConstructionIcon />
        </EmptyMedia>
        <EmptyTitle>{title} is coming soon</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
