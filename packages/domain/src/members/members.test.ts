import { describe, expect, it } from "vitest"

import type { Role } from "../enums"
import { checkMembershipChange } from "./index"
import type { MembershipChange } from "./index"

const remove: MembershipChange = { kind: "remove" }
const to = (role: Role): MembershipChange => ({ kind: "changeRole", role })

describe("checkMembershipChange", () => {
  it.each([
    // target role, change, admins before, allowed
    ["admin", remove, 1, false],
    ["admin", to("manager"), 1, false],
    ["admin", to("member"), 1, false],
    ["admin", to("admin"), 1, true],
    ["admin", remove, 2, true],
    ["admin", to("member"), 2, true],
    ["manager", remove, 1, true],
    ["member", to("admin"), 1, true],
    ["member", remove, 0, true],
  ] as const)("%s, %o with %i Admin(s) → %s", (role, change, admins, ok) => {
    const result = checkMembershipChange({ role }, change, admins)
    expect(result.ok).toBe(ok)
    if (!result.ok) expect(result.reason).toBe("last_admin")
  })
})
