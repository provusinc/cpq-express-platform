import { and, eq, gt, schema } from "@workspace/db"
import type { Db } from "@workspace/db"

/**
 * Session cookie names. Auth.js prefixes the name with `__Secure-` when the
 * app runs on https; both are accepted when reading.
 */
export const SESSION_COOKIE = "authjs.session-token"
export const SECURE_SESSION_COOKIE = "__Secure-authjs.session-token"

export function sessionCookieName(secure: boolean) {
  return secure ? SECURE_SESSION_COOKIE : SESSION_COOKIE
}

/** The signed-in User as the server layer sees it. */
export interface SessionUser {
  id: string
  email: string
  name: string | null
  image: string | null
  isPlatformAdmin: boolean
}

export interface Session {
  user: SessionUser
  expires: Date
}

/** Reads the session token from a request's `Cookie` header, if present. */
export function readSessionToken(headers: Headers): string | undefined {
  const header = headers.get("cookie")
  if (!header) return undefined
  const cookies = new Map<string, string>()
  for (const part of header.split(";")) {
    const eq = part.indexOf("=")
    if (eq === -1) continue
    const name = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (!cookies.has(name)) cookies.set(name, safeDecode(value))
  }
  return cookies.get(SECURE_SESSION_COOKIE) || cookies.get(SESSION_COOKIE)
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Looks up an unexpired database session and its User. */
export async function getSessionByToken(
  db: Db,
  sessionToken: string
): Promise<Session | null> {
  const [row] = await db
    .select({
      expires: schema.sessions.expires,
      user: {
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        image: schema.users.image,
        isPlatformAdmin: schema.users.isPlatformAdmin,
      },
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(
      and(
        eq(schema.sessions.sessionToken, sessionToken),
        gt(schema.sessions.expires, new Date())
      )
    )
    .limit(1)
  return row ?? null
}

/**
 * The session for a request, read from its cookie — works on every
 * subdomain because the cookie is scoped to `.<ROOT_DOMAIN>`. Framework-free,
 * so the tRPC context (and anything else server-side) can use it directly.
 */
export async function getSessionFromHeaders(
  db: Db,
  headers: Headers
): Promise<Session | null> {
  const token = readSessionToken(headers)
  return token ? getSessionByToken(db, token) : null
}
