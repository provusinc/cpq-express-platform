import "server-only"

import { can } from "@workspace/domain/policy"
import type { OrganizationAction } from "@workspace/domain/policy"

import { getCaller } from "@/trpc/server"

/**
 * For an Organization page (server component): the Organization's currency
 * and whether the caller may perform `action` — used to show or hide
 * controls. The API re-checks every command.
 */
export async function organizationAccess(action: OrganizationAction) {
  const caller = await getCaller()
  const [{ organization, membership }, session] = await Promise.all([
    caller.organization.current(),
    caller.auth.getSession(),
  ])
  const decision = can(
    {
      userId: session?.user.id ?? "",
      role: membership.role,
      isApprover: membership.isApprover,
    },
    action
  )
  return {
    allowed: decision.allowed,
    currencyCode: organization.currencyCode,
  }
}
