import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

import { dbEnv } from "@workspace/db/env"

/**
 * Validated environment for the web app. Imported by next.config.ts, so
 * `next dev` / `next build` fail fast on a missing or malformed variable.
 * Read env through `env.X`, never `process.env.X`.
 *
 * Every variable is documented in the root `.env.example`.
 */
export const env = createEnv({
  extends: [dbEnv()],
  shared: {
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  },
  server: {
    ROOT_DOMAIN: z.string().min(1).default("localtest.me"),
    APP_URL: z.url().default("http://app.localtest.me:3000"),

    S3_ENDPOINT: z.url(),
    S3_REGION: z.string().min(1).default("us-east-1"),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    S3_FORCE_PATH_STYLE: z.stringbool().default(false),

    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().positive(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_SECURE: z.stringbool().default(false),
    EMAIL_FROM: z.string().min(1),

    AUTH_SECRET:
      process.env.NODE_ENV === "production"
        ? z.string().min(32)
        : z.string().min(1).optional(),
    AUTH_GOOGLE_ID: z.string().optional(),
    AUTH_GOOGLE_SECRET: z.string().optional(),
    AUTH_MICROSOFT_ENTRA_ID_ID: z.string().optional(),
    AUTH_MICROSOFT_ENTRA_ID_SECRET: z.string().optional(),
    AUTH_MICROSOFT_ENTRA_ID_ISSUER: z.url().optional(),
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
