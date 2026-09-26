import type { RouterOutputs } from "@workspace/api"

type ClassificationRef = NonNullable<
  RouterOutputs["customer"]["byId"]["customerType"]
>

/**
 * A Customer's Customer Type or Industry: its name, muted with "(retired)"
 * when the value is retired (kept until changed), or a muted dash for none.
 */
export function ClassificationName({
  value,
}: {
  value: ClassificationRef | null
}) {
  if (!value) return <span className="text-muted-foreground">—</span>
  if (!value.retired) return <>{value.name}</>
  return (
    <span className="text-muted-foreground" title="Retired value">
      {value.name} (retired)
    </span>
  )
}
