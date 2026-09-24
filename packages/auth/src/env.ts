import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

/**
 * Auth env: domains, SMTP (magic links) and OAuth credentials. Used by
 * `@workspace/auth/next`, and merged into the web app's env via
 * `extends: [authEnv()]` so the app validates it at startup too.
 */
export function authEnv() {
  return createEnv({
    server: {
      ROOT_DOMAIN: z.string().min(1).default("localtest.me"),
      APP_URL: z.url().default("http://app.localtest.me:3000"),

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
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
    skipValidation:
      !!process.env.SKIP_ENV_VALIDATION ||
      process.env.npm_lifecycle_event === "lint",
  })
}

export type AuthEnv = ReturnType<typeof authEnv>
