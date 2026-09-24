import { ConstructionIcon } from "lucide-react"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/shell/empty"

import { PageHeader } from "./page-header"

/** Stand-in for a feature area that a later ticket builds. */
export function PlaceholderPage({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ConstructionIcon />
          </EmptyMedia>
          <EmptyTitle>{title} are coming soon</EmptyTitle>
          <EmptyDescription>
            This part of CPQ Express hasn&apos;t been built yet.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </>
  )
}
