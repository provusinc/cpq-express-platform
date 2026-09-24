import type { RouterInputs } from "@workspace/api"

export type ResourceRoleListInput = RouterInputs["resourceRole"]["list"]

/**
 * The Resource Roles list's first query. The page prefetches exactly this
 * input, so it must match what `ResourceRolesList` asks for first.
 */
export const INITIAL_RESOURCE_ROLE_LIST_INPUT = {
  status: "all",
  page: 1,
  pageSize: 25,
} satisfies ResourceRoleListInput
