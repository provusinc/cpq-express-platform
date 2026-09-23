import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

/**
 * Database env. Used standalone by db scripts, and merged into the web app's
 * env via `extends: [dbEnv()]` so the app validates it at startup too.
 */
export function dbEnv() {
  return createEnv({
    server: {
      DATABASE_URL: z.url(),
      TEST_DATABASE_URL: z.url().optional(),
    },
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
    skipValidation:
      !!process.env.SKIP_ENV_VALIDATION ||
      process.env.npm_lifecycle_event === "lint",
  })
}
