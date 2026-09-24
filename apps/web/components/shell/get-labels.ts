import "server-only"

import { cache } from "react"

import { resolveLabels } from "@workspace/domain/settings"
import type { Labels } from "@workspace/domain/settings"

import { getCaller } from "@/trpc/server"

/**
 * The request's Organization labels for server components (`settings.labels`,
 * once per request). Falls back to the canonical names when the caller may
 * not read them (e.g. in `generateMetadata` for a signed-out visitor): the
 * Organization layout decides access, not this.
 */
export const getLabels = cache(async (): Promise<Labels> => {
  try {
    return await (await getCaller()).settings.labels()
  } catch {
    return resolveLabels()
  }
})
