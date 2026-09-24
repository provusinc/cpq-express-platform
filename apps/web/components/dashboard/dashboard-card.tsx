import { ArrowRightIcon } from "lucide-react"
import Link from "next/link"

import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { cn } from "@workspace/ui/lib/utils"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/shell/empty"

/**
 * One Dashboard tile: shadcn `Card` with a title, a one-line description
 * and a link into the list it summarises (usually the Quote list with a
 * `?insight=` / `?status=` filter) at the top right.
 */
export function DashboardCard({
  title,
  description,
  link,
  className,
  contentClassName,
  children,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  link?: { href: string; label: string }
  className?: string
  contentClassName?: string
  children: React.ReactNode
}) {
  return (
    <Card className={cn("min-w-0 gap-3", className)}>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        {description && (
          <CardDescription className="text-xs">{description}</CardDescription>
        )}
        {link && (
          <CardAction>
            <Button
              variant="ghost"
              size="sm"
              className="-mt-1 -mr-2 text-muted-foreground hover:text-foreground"
              render={<Link href={link.href} />}
              nativeButton={false}
            >
              {link.label}
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent
        className={cn("flex min-h-0 flex-1 flex-col", contentClassName)}
      >
        {children}
      </CardContent>
    </Card>
  )
}

/** A tile with nothing to list: the app's `Empty`, compact. */
export function TileEmpty({
  icon,
  children,
}: {
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Empty className="flex-1 gap-3 border border-dashed p-4 md:p-5">
      <EmptyHeader className="gap-1.5">
        <EmptyMedia variant="icon" className="size-8 rounded-lg">
          {icon}
        </EmptyMedia>
        <EmptyDescription className="text-xs">{children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
