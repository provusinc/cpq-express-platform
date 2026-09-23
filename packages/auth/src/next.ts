/**
 * The Auth.js instance for the web app: Drizzle adapter, database sessions,
 * email magic link (SMTP) plus Google / Microsoft Entra ID when configured.
 *
 * - `handlers` — mount at `app/api/auth/[...nextauth]/route.ts`.
 * - `auth()`   — the session in server components / route handlers.
 * - `oauthProviders` — the OAuth buttons the sign-in page should show.
 *
 * Sign-in happens on `app.<ROOT_DOMAIN>`; the session cookie is scoped to
 * `.<ROOT_DOMAIN>` so every subdomain (Organizations, `admin.`) sees it. All
 * Auth.js URLs (magic links, callbacks) are built from APP_URL, never from
 * the request's Host header.
 */
import { DrizzleAdapter } from "@auth/drizzle-adapter"
import NextAuth from "next-auth"
import type { NextAuthConfig } from "next-auth"
import type { Provider } from "next-auth/providers"
import Google from "next-auth/providers/google"
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id"
import Nodemailer from "next-auth/providers/nodemailer"

import { schema } from "@workspace/db"
import { db } from "@workspace/db/client"

import { authEnv } from "./env"
import { resolveRedirect } from "./redirect"
import { sessionCookieName } from "./session"

declare module "next-auth" {
  interface User {
    isPlatformAdmin?: boolean
  }
}

const env = authEnv()

// next-auth rewrites every incoming auth request's origin to AUTH_URL, so
// magic links and OAuth callbacks always point at the app host (a spoofed
// Host / X-Forwarded-Host header can't redirect them).
process.env.AUTH_URL ??= env.APP_URL

const secure = new URL(env.APP_URL).protocol === "https:"

// Local dev may run without AUTH_SECRET; production env validation requires it.
const secret = env.AUTH_SECRET ?? "cpq-express-insecure-development-secret"

function smtpUrl() {
  const url = new URL(
    `${env.SMTP_SECURE ? "smtps" : "smtp"}://${env.SMTP_HOST}`
  )
  url.port = String(env.SMTP_PORT)
  if (env.SMTP_USER) {
    url.username = env.SMTP_USER
    url.password = env.SMTP_PASSWORD ?? ""
  }
  return url.toString()
}

/** OAuth providers enabled by env, for the sign-in page's buttons. */
export const oauthProviders: { id: string; name: string }[] = []

const providers: Provider[] = [
  Nodemailer({
    // A connection URL rather than an options object: the provider deep-merges
    // options over a default `auth: { user: "", pass: "" }`, which makes
    // nodemailer attempt (and fail) AUTH against servers that advertise it.
    server: smtpUrl(),
    from: env.EMAIL_FROM,
  }),
]

if (env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET) {
  providers.push(
    Google({
      clientId: env.AUTH_GOOGLE_ID,
      clientSecret: env.AUTH_GOOGLE_SECRET,
      // Google only returns verified addresses, so it may join the User who
      // first signed in by magic link with the same email.
      allowDangerousEmailAccountLinking: true,
    })
  )
  oauthProviders.push({ id: "google", name: "Google" })
}

if (env.AUTH_MICROSOFT_ENTRA_ID_ID && env.AUTH_MICROSOFT_ENTRA_ID_SECRET) {
  providers.push(
    MicrosoftEntraID({
      clientId: env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
    })
  )
  oauthProviders.push({ id: "microsoft-entra-id", name: "Microsoft" })
}

const config = {
  adapter: DrizzleAdapter(db, {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),
  providers,
  secret,
  trustHost: true,
  session: { strategy: "database", maxAge: 30 * 24 * 60 * 60 },
  useSecureCookies: secure,
  cookies: {
    sessionToken: {
      name: sessionCookieName(secure),
      options: {
        domain: `.${env.ROOT_DOMAIN}`,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure,
      },
    },
  },
  // Paths on the app host (see apps/web/proxy.ts).
  pages: {
    signIn: "/sign-in",
    verifyRequest: "/check-email",
    error: "/sign-in",
  },
  callbacks: {
    redirect: ({ url, baseUrl }) =>
      resolveRedirect(url, baseUrl, {
        appUrl: env.APP_URL,
        rootDomain: env.ROOT_DOMAIN,
      }),
    session: ({ session, user }) => ({
      ...session,
      user: {
        ...session.user,
        id: user.id,
        isPlatformAdmin: user.isPlatformAdmin ?? false,
      },
    }),
  },
} satisfies NextAuthConfig

export const { handlers, auth } = NextAuth(config)
