import { createHash, randomBytes } from "node:crypto"

/**
 * Invitation tokens: 32 random bytes, base64url, emailed as part of the
 * accept link. Only `hashInvitationToken(token)` is stored.
 */
export function createInvitationToken() {
  const token = randomBytes(32).toString("base64url")
  return { token, tokenHash: hashInvitationToken(token) }
}

/** SHA-256 hex of a token, as stored in `invitations.token_hash`. */
export function hashInvitationToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}
