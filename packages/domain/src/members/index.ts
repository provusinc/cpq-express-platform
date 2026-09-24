import type { Role } from "../enums"

/**
 * Membership management rules. Who may manage members at all is the policy's
 * `can(actor, "members.manage")`; these rules protect the Organization itself.
 */

/** A change to one Membership that could leave the Organization without an Admin. */
export type MembershipChange =
  | { kind: "remove" }
  | { kind: "changeRole"; role: Role }

export type MembershipChangeCheck =
  | { ok: true }
  | { ok: false; reason: "last_admin"; message: string }

/**
 * An Organization always keeps at least one Admin: the last Admin can't be
 * removed or given another Role — not even by themselves.
 *
 * `adminCount` is the number of Admin Memberships before the change
 * (including `target` when it is an Admin).
 */
export function checkMembershipChange(
  target: { role: Role },
  change: MembershipChange,
  adminCount: number
): MembershipChangeCheck {
  const losesAdmin =
    target.role === "admin" &&
    (change.kind === "remove" || change.role !== "admin")
  if (losesAdmin && adminCount <= 1) {
    return {
      ok: false,
      reason: "last_admin",
      message:
        change.kind === "remove"
          ? "This is the Organization's last Admin. Make someone else an Admin before removing them."
          : "This is the Organization's last Admin. Make someone else an Admin before changing their Role.",
    }
  }
  return { ok: true }
}
