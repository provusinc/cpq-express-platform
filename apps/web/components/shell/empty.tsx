/**
 * shadcn's `Empty` with the app's empty-state look: the icon variant is a
 * larger accent tile with a hairline ring, the title one step up. Import
 * the Empty parts from here, not from `@workspace/ui/components/empty`.
 */
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia as StockEmptyMedia,
  EmptyTitle as StockEmptyTitle,
} from "@workspace/ui/components/empty"
import { cn } from "@workspace/ui/lib/utils"

const ICON_TILE =
  "size-10 rounded-xl bg-accent text-primary ring-1 ring-primary/15 ring-inset [&_svg:not([class*='size-'])]:size-5"

function EmptyMedia({
  variant = "default",
  className,
  ...props
}: React.ComponentProps<typeof StockEmptyMedia>) {
  return (
    <StockEmptyMedia
      variant={variant}
      className={cn(variant === "icon" && ICON_TILE, className)}
      {...props}
    />
  )
}

function EmptyTitle({
  className,
  ...props
}: React.ComponentProps<typeof StockEmptyTitle>) {
  return (
    <StockEmptyTitle
      className={cn("text-base font-semibold", className)}
      {...props}
    />
  )
}

export {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
}
