import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

/**
 * Object storage env (S3-compatible; MinIO locally). Used by
 * `createS3Storage()`, and merged into the web app's env via
 * `extends: [storageEnv()]` so the app validates it at startup too.
 */
export function storageEnv() {
  return createEnv({
    server: {
      S3_ENDPOINT: z.url(),
      S3_REGION: z.string().min(1).default("us-east-1"),
      S3_ACCESS_KEY_ID: z.string().min(1),
      S3_SECRET_ACCESS_KEY: z.string().min(1),
      S3_BUCKET: z.string().min(1),
      S3_FORCE_PATH_STYLE: z.stringbool().default(false),
    },
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
    skipValidation:
      !!process.env.SKIP_ENV_VALIDATION ||
      process.env.npm_lifecycle_event === "lint",
  })
}

export type StorageEnv = ReturnType<typeof storageEnv>
