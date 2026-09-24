import type { RouterInputs } from "@workspace/api"

export type AccountListInput = RouterInputs["account"]["list"]

/**
 * The Accounts list's first query. The page prefetches exactly this input,
 * so it must match what `AccountsList` asks for on first render.
 */
export const INITIAL_ACCOUNT_LIST_INPUT = {
  status: "active",
  page: 1,
  pageSize: 25,
} satisfies AccountListInput
