import { Skeleton } from "@workspace/ui/components/skeleton"

/**
 * Loading skeletons for `loading.tsx`. Only the editor tabs have one: a
 * boundary around the Organization pages would stream the Quote header in
 * a Suspense boundary, and a click on its actions before that boundary
 * hydrates is lost.
 */

/** The editor tab body while it streams in (the header stays). */
export function TabSkeleton() {
  return (
    <div
      className="flex flex-col gap-4"
      role="status"
      aria-label="Loading the tab"
    >
      <div className="flex gap-2">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-28" />
      </div>
      <TableSkeleton rows={4} />
    </div>
  )
}

function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="h-9 border-b bg-muted/60" />
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-6 border-b px-3 py-3 last:border-0"
        >
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-1/6" />
          <Skeleton className="h-4 w-1/12" />
          <Skeleton className="ml-auto h-4 w-20" />
        </div>
      ))}
    </div>
  )
}
