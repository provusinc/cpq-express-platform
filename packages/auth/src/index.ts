/**
 * @workspace/auth — framework-free session helpers. Safe to import from any
 * server package (e.g. the tRPC context); pulls in no Next.js code.
 *
 * - `@workspace/auth/next`  — the Auth.js instance (route handlers, `auth()`),
 *                             providers and cookie config. App only.
 * - `@workspace/auth/react` — client `signIn` / `signOut`.
 * - `@workspace/auth/env`   — auth env schema (merged into the app's env).
 * - `@workspace/auth/mailer` — `Mailer` (SMTP, or in-memory for tests) for
 *                             non-auth email such as Invitations.
 */
export {
  getSessionByToken,
  getSessionFromHeaders,
  readSessionToken,
  SECURE_SESSION_COOKIE,
  SESSION_COOKIE,
  sessionCookieName,
} from "./session"
export type { Session, SessionUser } from "./session"
export { isAllowedRedirect, resolveRedirect } from "./redirect"
export type { RedirectPolicy } from "./redirect"
