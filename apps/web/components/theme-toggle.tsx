"use client"

import { MoonIcon, SunIcon } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@workspace/ui/components/button"
import { Kbd } from "@workspace/ui/components/kbd"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

/**
 * One button that flips light and dark (as on shadcn's site). Until it is
 * first used the theme follows the OS (`defaultTheme="system"` in
 * `ThemeProvider`); the `d` key does the same flip.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const next = resolvedTheme === "dark" ? "light" : "dark"

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle theme"
            aria-keyshortcuts="D"
            onClick={() => setTheme(next)}
          />
        }
      >
        <SunIcon className="size-4 scale-100 rotate-0 transition-transform dark:scale-0 dark:-rotate-90" />
        <MoonIcon className="absolute size-4 scale-0 rotate-90 transition-transform dark:scale-100 dark:rotate-0" />
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">
        Toggle theme <Kbd>D</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}
