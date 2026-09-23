import { randomBytes } from "node:crypto"

import type { SessionUser } from "@workspace/auth"
import { schema, uuidv7 } from "@workspace/db"
import type { Db } from "@workspace/db"

type NewUser = typeof schema.users.$inferInsert

/** Inserts a User (unique email by default). Returns the full row. */
export async function createUser(db: Db, overrides: Partial<NewUser> = {}) {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `user-${uuidv7()}@example.test`,
      name: "Test User",
      emailVerified: new Date(),
      ...overrides,
    })
    .returning()
  return user!
}

/**
 * Inserts a database session for `user`, as Auth.js does after sign-in.
 * `cookie` is a ready-made `Cookie` header value for `createTestCaller`'s
 * `headers`, to exercise the real cookie → session path.
 */
export async function createSession(
  db: Db,
  user: { id: string },
  { expires = new Date(Date.now() + 24 * 60 * 60 * 1000) } = {}
) {
  const sessionToken = randomBytes(32).toString("hex")
  await db
    .insert(schema.sessions)
    .values({ sessionToken, userId: user.id, expires })
  return {
    sessionToken,
    expires,
    cookie: `authjs.session-token=${sessionToken}`,
  }
}

/** Narrows a users row (or any superset) to the shape carried in the session. */
export function toSessionUser(user: SessionUser): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    isPlatformAdmin: user.isPlatformAdmin,
  }
}
