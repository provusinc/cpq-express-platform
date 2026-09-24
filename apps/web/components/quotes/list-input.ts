import type { RouterInputs } from "@workspace/api"

export type QuoteListInput = RouterInputs["quote"]["list"]

/**
 * The Quote list's first query. The page prefetches exactly this input, so
 * it must match what `QuotesList` asks for on first render.
 */
export const INITIAL_QUOTE_LIST_INPUT = {
  owner: "all",
  sort: { by: "createdAt", direction: "desc" },
  page: 1,
  pageSize: 25,
} satisfies QuoteListInput
