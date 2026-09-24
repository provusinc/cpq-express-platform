/**
 * Reading tRPC errors in client components. Input validation failures carry
 * zod's flattened issues in `data.zodError`, and deletes blocked by
 * references (`inUseError` in the API) carry `data.inUse` (see the API's
 * error formatter); everything else carries a human message.
 */
import type { InUseDetails } from "@workspace/api"

export type InUse = InUseDetails

interface ErrorShape {
  message?: unknown
  data?: {
    code?: unknown
    zodError?: {
      formErrors?: string[]
      fieldErrors?: Record<string, string[] | undefined>
    } | null
    inUse?: unknown
  } | null
}

const FALLBACK = "Something went wrong. Try again."

/** The tRPC error code (`"CONFLICT"`, …), if `error` came from the API. */
export function errorCode(error: unknown): string | undefined {
  const code = (error as ErrorShape | null)?.data?.code
  return typeof code === "string" ? code : undefined
}

/** Field → first message, for `form.setError`. */
export function fieldErrors(error: unknown): Record<string, string> {
  const fields = (error as ErrorShape | null)?.data?.zodError?.fieldErrors ?? {}
  const result: Record<string, string> = {}
  for (const [field, messages] of Object.entries(fields)) {
    if (messages?.[0]) result[field] = messages[0]
  }
  return result
}

/** The structured details of a blocked delete ("in use"), or null. */
export function inUseOf(error: unknown): InUse | null {
  const inUse = (error as ErrorShape | null)?.data?.inUse
  return inUse && typeof inUse === "object" && "kind" in inUse
    ? (inUse as InUse)
    : null
}

/**
 * One sentence to show the person (a toast, a form alert). Internal server
 * errors show the fallback, never their technical message.
 */
export function errorMessage(error: unknown, fallback = FALLBACK): string {
  const shape = error as ErrorShape | null
  const zod = shape?.data?.zodError
  if (zod) {
    return (
      zod.formErrors?.[0] ?? Object.values(fieldErrors(error))[0] ?? fallback
    )
  }
  if (errorCode(error) === "INTERNAL_SERVER_ERROR") return fallback
  return typeof shape?.message === "string" && shape.message
    ? shape.message
    : fallback
}
