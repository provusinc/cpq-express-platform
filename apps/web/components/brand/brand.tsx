import { cn } from "@workspace/ui/lib/utils"

/**
 * The CPQ Express mark: three line items stacked like a Quote, the last
 * one (the total) drawn in iris. Decorative; the wordmark carries the name.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden
      className={cn("size-8 shrink-0", className)}
    >
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <rect
        x="8"
        y="9"
        width="16"
        height="3"
        rx="1.5"
        className="fill-primary-foreground"
      />
      <rect
        x="8"
        y="14.5"
        width="11"
        height="3"
        rx="1.5"
        className="fill-primary-foreground/70"
      />
      <rect x="8" y="20" width="16" height="3" rx="1.5" className="fill-iris" />
    </svg>
  )
}

/** The mark and the product name. */
export function BrandLockup({
  className,
  tone = "default",
}: {
  className?: string
  /** "inverse" sets the name in the primary foreground (on a primary panel). */
  tone?: "default" | "inverse"
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark
        className={
          tone === "inverse"
            ? "[&>rect:first-child]:fill-primary-foreground/12 dark:[&>rect:first-child]:fill-primary"
            : undefined
        }
      />
      <span
        className={cn(
          "text-[0.95rem] font-semibold tracking-[-0.01em]",
          tone === "inverse" && "text-primary-foreground"
        )}
      >
        CPQ Express
      </span>
    </span>
  )
}
