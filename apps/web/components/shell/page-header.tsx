/** Title row at the top of an Organization page. */
export function PageHeader({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  /** Page actions, right-aligned. */
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl leading-tight font-semibold tracking-[-0.015em] text-balance">
          {title}
        </h1>
        {description && (
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {children && (
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      )}
    </div>
  )
}
