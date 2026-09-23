import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

import { authEnv } from "@workspace/auth/env"
import { dbEnv } from "@workspace/db/env"

/**
 * Validated environment for the web app. Imported by next.config.ts, so
 * `next dev` / `next build` fail fast on a missing or malformed variable.
 * Read env through `env.X`, never `process.env.X`.
 *
 * Every variable is documented in the root `.env.example`.
 */
export const env = createEnv({
  // Domains (ROOT_DOMAIN, APP_URL), SMTP and AUTH_* come from authEnv.
  extends: [dbEnv(), authEnv()],
  shared: {
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  },
  server: {
    S3_ENDPOINT: z.url(),
    S3_REGION: z.string().min(1).default("us-east-1"),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    S3_FORCE_PATH_STYLE: z.stringbool().default(false),
  },
  client: {},
  experimental__runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
  },
  emptyStringAsUndefined: true,
  skipValidation:
    !!process.env.SKIP_ENV_VALIDATION ||
    process.env.npm_lifecycle_event === "lint",
})
