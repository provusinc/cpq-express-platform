import type { RouterInputs } from "@workspace/api"

export type CustomerListInput = RouterInputs["customer"]["list"]

/**
 * The Customers list's first query. The page prefetches exactly this input,
 * so it must match what `CustomersList` asks for on first render.
 */
export const INITIAL_CUSTOMER_LIST_INPUT = {
  status: "active",
  page: 1,
  pageSize: 25,
} satisfies CustomerListInput
