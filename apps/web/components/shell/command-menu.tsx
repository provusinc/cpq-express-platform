"use client"

import { keepPreviousData, useQuery } from "@tanstack/react-query"
import {
  FileTextIcon,
  MoonIcon,
  PlusIcon,
  SearchIcon,
  SunIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { useRouter } from "next/navigation"
import { useDeferredValue, useEffect, useState } from "react"

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@workspace/ui/components/command"
import { Kbd, KbdGroup } from "@workspace/ui/components/kbd"
import { cn } from "@workspace/ui/lib/utils"

import { QuoteStatusBadge } from "@/components/quotes/quote-status-badge"
import { INITIAL_QUOTE_LIST_INPUT } from "@/components/quotes/list-input"
import { formatMoney } from "@/lib/money"
import { useTRPC } from "@/trpc/react"

import { useNavItems, useShell } from "./shell-context"
import { navIconClass } from "./tints"

/**
 * The ⌘K command menu: find a Quote by name or Customer (server search),
 * jump to any page in the navigation, start a New Quote or switch the
 * theme. `open` is owned by the shell so the header button opens it too.
 */
export function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onOpenChange])

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command menu"
      description="Find a Quote, go to a page or run an action."
      className="top-[18%] shadow-float sm:max-w-xl"
    >
      <CommandMenuContent close={() => onOpenChange(false)} />
    </CommandDialog>
  )
}

/**
 * The menu's content, mounted only while it is open: its queries share
 * keys with the Quote list's, and an observer mounted in the shell during
 * SSR would stop the page's `HydrateClient` from hydrating them in time.
 */
function CommandMenuContent({ close }: { close: () => void }) {
  const router = useRouter()
  const trpc = useTRPC()
  const { newQuote } = useShell()
  const nav = useNavItems()
  const { setTheme } = useTheme()
  const [search, setSearch] = useState("")
  const query = useDeferredValue(search.trim())

  const recent = useQuery({
    ...trpc.quote.insights.queryOptions(),
    enabled: !query,
  })
  const found = useQuery({
    ...trpc.quote.list.queryOptions({
      ...INITIAL_QUOTE_LIST_INPUT,
      pageSize: 8,
      search: query,
    }),
    enabled: query.length > 0,
    placeholderData: keepPreviousData,
  })
  const quotes = query
    ? (found.data?.rows ?? []).map((q) => ({
        id: q.id,
        name: q.name,
        customer: q.customer.name,
        status: q.status,
        total: formatMoney(q.total, q.currencyCode),
      }))
    : (recent.data?.recent ?? []).map((q) => ({
        id: q.id,
        name: q.name,
        customer: q.customer.name,
        status: q.status,
        total: formatMoney(q.total, q.currencyCode),
      }))

  const run = (action: () => void) => {
    close()
    action()
  }

  return (
    <Command loop className="rounded-xl!">
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder="Find a Quote, jump to a page…"
        aria-label="Search commands"
      />
      <CommandList className="max-h-[min(26rem,60svh)] px-1 pb-1">
        <CommandEmpty>
          {found.isFetching ? "Searching…" : "Nothing matches."}
        </CommandEmpty>
        {quotes.length > 0 && (
          <CommandGroup heading={query ? "Quotes" : "Your recent Quotes"}>
            {quotes.map((quote) => (
              <CommandItem
                key={quote.id}
                value={`quote ${quote.id} ${quote.name} ${quote.customer}`}
                keywords={query ? [query] : undefined}
                onSelect={() => run(() => router.push(`/quotes/${quote.id}`))}
              >
                <FileTextIcon className="text-muted-foreground" />
                <span className="min-w-0 truncate font-medium">
                  {quote.name}
                </span>
                <span className="hidden min-w-0 truncate text-muted-foreground sm:inline">
                  {quote.customer}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-2">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {quote.total}
                  </span>
                  <QuoteStatusBadge status={quote.status} />
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Actions">
          <CommandItem value="new quote create" onSelect={() => run(newQuote)}>
            <PlusIcon className="text-primary" />
            New Quote
          </CommandItem>
        </CommandGroup>
        <CommandSeparator className="my-1" />
        <CommandGroup heading="Go to">
          {nav.map((item) => (
            <CommandItem
              key={item.href}
              value={`go ${item.label}`}
              onSelect={() => run(() => router.push(item.href))}
            >
              <item.icon
                className={navIconClass(item.term) ?? "text-muted-foreground"}
              />
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator className="my-1" />
        <CommandGroup heading="Theme">
          {(
            [
              ["light", "Light", SunIcon],
              ["dark", "Dark", MoonIcon],
            ] as const
          ).map(([value, label, Icon]) => (
            <CommandItem
              key={value}
              value={`theme ${label}`}
              onSelect={() => run(() => setTheme(value))}
            >
              <Icon className="text-muted-foreground" />
              {label} theme
              <CommandShortcut className="tracking-normal">D</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

/** The header's search field look-alike that opens the command menu. */
export function CommandMenuTrigger({ className }: { className?: string }) {
  const { openCommandMenu } = useShell()
  return (
    <button
      type="button"
      onClick={openCommandMenu}
      aria-label="Open the command menu"
      aria-keyshortcuts="Meta+K Control+K"
      className={cn(
        "group flex h-8 items-center gap-2 rounded-lg border bg-muted/50 pr-1.5 pl-2.5 text-sm text-muted-foreground transition-colors outline-none hover:border-ring/40 hover:bg-background hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
        className
      )}
    >
      <SearchIcon className="size-4 shrink-0" aria-hidden />
      <span className="hidden truncate lg:inline">Find or jump to…</span>
      <KbdGroup className="ml-auto hidden lg:inline-flex">
        <Kbd className="border bg-background">⌘</Kbd>
        <Kbd className="border bg-background">K</Kbd>
      </KbdGroup>
    </button>
  )
}
