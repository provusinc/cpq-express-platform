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

/**
 * One Overview card: shadcn `Card` with a small title, an optional one-line
 * description and an optional link at the top right (into the tab or
 * record that holds the detail).
 */
export function OverviewCard({
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
    <Card className={cn("min-w-0 gap-4", className)}>
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
      <CardContent className={cn("flex flex-1 flex-col", contentClassName)}>
        {children}
      </CardContent>
    </Card>
  )
}
