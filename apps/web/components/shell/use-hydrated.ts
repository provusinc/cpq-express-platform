import { useSyncExternalStore } from "react"

const noSubscribe = () => () => {}

/**
 * False on the server and during hydration, true afterwards. Components
 * above a page's `HydrateClient` (the shell, the Quote editor layout) use
 * it before observing one of the page's queries: an observer that exists
 * before the boundary hydrates makes it defer that query, so the page
 * would fetch it again during SSR, without the session.
 */
export function useHydrated() {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false
  )
}
