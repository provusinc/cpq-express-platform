import { describe, expect, it } from "vitest"

import { QUOTE_STATUSES, type QuoteStatus, type Role } from "../enums"
import {
  type Actor,
  can,
  checkDeletableStatuses,
  DEFAULT_DELETABLE_STATUSES,
  DELETABLE_STATUS_OPTIONS,
  type DenialReason,
  ORGANIZATION_ACTIONS,
  type QuoteFacts,
  quotePermissions,
} from "./index"

const actor = (userId: string, role: Role, isApprover = false): Actor => ({
  userId,
  role,
  isApprover,
})

const admin = actor("u-admin", "admin")
const manager = actor("u-manager", "manager")
const member = actor("u-member", "member")
const otherMember = actor("u-member-2", "member")
const approver = actor("u-approver", "member", true)
const adminApprover = actor("u-admin", "admin", true)
const managerApprover = actor("u-manager", "manager", true)

const quote = (
  owner: Actor | { userId: string; role: Role | null },
  status: QuoteStatus = "draft",
  total: string | null = "1000.0000"
): QuoteFacts => ({
  ownerId: owner.userId,
  ownerRole: owner.role,
  status,
  total,
})

/** A User who has been removed from the Organization but still owns Quotes. */
const removed = { userId: "u-removed", role: null }

type Row = [string, Actor, QuoteFacts, true | DenialReason]

function expectDecision(
  decision: ReturnType<typeof can>,
  expected: true | DenialReason
) {
  if (expected === true) {
    expect(decision).toEqual({ allowed: true })
  } else {
    expect(decision).toMatchObject({ allowed: false, reason: expected })
    if (!decision.allowed) expect(decision.message).not.toBe("")
  }
}

// Ported from portal rbac.ts (ensureCanMutateQuote / ensureCanEditQuote).
describe("can(quote.edit)", () => {
  it.each<Row>([
    ["Admin edits anyone's Quote", admin, quote(member), true],
    ["Admin edits another Manager's Quote", admin, quote(manager), true],
    ["Member edits own Quote", member, quote(member), true],
    [
      "Member can't edit a colleague's Quote",
      member,
      quote(otherMember),
      "not_allowed_to_edit",
    ],
    [
      "Member can't edit an Admin's Quote",
      member,
      quote(admin),
      "not_allowed_to_edit",
    ],
    ["Manager edits own Quote", manager, quote(manager), true],
    ["Manager edits a Member's Quote", manager, quote(member), true],
    [
      "Manager can't edit an Admin's Quote",
      manager,
      quote(admin),
      "not_allowed_to_edit",
    ],
    [
      "Manager can't edit another Manager's Quote",
      manager,
      quote(actor("u-m2", "manager")),
      "not_allowed_to_edit",
    ],
    ["Admin edits a removed member's Quote", admin, quote(removed), true],
    [
      "Manager can't edit a removed member's Quote",
      manager,
      quote(removed),
      "not_allowed_to_edit",
    ],
    [
      "Approver flag grants no edit rights",
      approver,
      quote(member),
      "not_allowed_to_edit",
    ],
    ["Rejected is editable", member, quote(member, "rejected"), true],
    [
      "Customer Rejected is editable",
      member,
      quote(member, "customer_rejected"),
      true,
    ],
    [
      "Pending Approval is locked",
      member,
      quote(member, "pending_approval"),
      "locked",
    ],
    [
      "Approved is locked even for Admin",
      admin,
      quote(member, "approved"),
      "locked",
    ],
    [
      "Pending Customer Approval is locked",
      admin,
      quote(admin, "pending_customer_approval"),
      "locked",
    ],
    [
      "Customer Approved is locked",
      admin,
      quote(admin, "customer_approved"),
      "locked",
    ],
    [
      "Role is checked before the lock",
      member,
      quote(otherMember, "approved"),
      "not_allowed_to_edit",
    ],
  ])("%s", (_name, who, facts, expected) => {
    expectDecision(can(who, "quote.edit", facts), expected)
  })
})

// Ported from portal rbac.ts (ensureCanDeleteQuote) with v1's guarded
// deletable set.
describe("can(quote.delete)", () => {
  it.each<Row>([
    ["Owner deletes a Draft", member, quote(member, "draft"), true],
    ["Owner deletes a Rejected Quote", member, quote(member, "rejected"), true],
    ["Admin deletes anyone's Draft", admin, quote(member, "draft"), true],
    [
      "Manager can't delete a Member's Quote",
      manager,
      quote(member),
      "owner_or_admin_only",
    ],
    [
      "Member can't delete a colleague's Quote",
      member,
      quote(otherMember),
      "owner_or_admin_only",
    ],
    [
      "Customer Rejected isn't deletable by default",
      member,
      quote(member, "customer_rejected"),
      "status_not_deletable",
    ],
    [
      "Approved is never deletable",
      admin,
      quote(admin, "approved"),
      "status_not_deletable",
    ],
  ])("%s (default settings)", (_name, who, facts, expected) => {
    expectDecision(can(who, "quote.delete", facts), expected)
  })

  it("follows the Organization's deletable statuses", () => {
    const settings = {
      deletableStatuses: ["customer_rejected"] as QuoteStatus[],
    }
    expectDecision(
      can(member, "quote.delete", quote(member, "customer_rejected"), settings),
      true
    )
    expectDecision(
      can(member, "quote.delete", quote(member, "draft"), settings),
      "status_not_deletable"
    )
  })

  it.each([
    "pending_approval",
    "approved",
    "pending_customer_approval",
    "customer_approved",
  ] as const)(
    "never deletes a %s Quote, even if settings list it",
    (status) => {
      const settings = { deletableStatuses: [...QUOTE_STATUSES] }
      expectDecision(
        can(admin, "quote.delete", quote(admin, status), settings),
        "status_not_deletable"
      )
    }
  )

  it("offers only uncommitted statuses as deletable options", () => {
    expect(DELETABLE_STATUS_OPTIONS).toEqual([
      "draft",
      "rejected",
      "customer_rejected",
    ])
    expect(DEFAULT_DELETABLE_STATUSES).toEqual(["draft", "rejected"])
  })

  it("splits a proposed deletable set into accepted and refused", () => {
    expect(
      checkDeletableStatuses([
        "draft",
        "approved",
        "draft",
        "customer_approved",
      ])
    ).toEqual({
      accepted: ["draft"],
      refused: ["approved", "customer_approved"],
    })
  })
})

describe("can(quote.submit)", () => {
  it.each<Row>([
    ["Owner submits a Draft", member, quote(member, "draft"), true],
    [
      "Owner resubmits a Rejected Quote",
      member,
      quote(member, "rejected"),
      true,
    ],
    [
      "Owner resubmits a Customer Rejected Quote",
      member,
      quote(member, "customer_rejected"),
      true,
    ],
    [
      "Admin can't submit someone else's Quote",
      admin,
      quote(member),
      "owner_only",
    ],
    [
      "Manager can't submit a Member's Quote",
      manager,
      quote(member),
      "owner_only",
    ],
    [
      "Can't submit while Pending Approval",
      member,
      quote(member, "pending_approval"),
      "wrong_status",
    ],
    [
      "Can't submit an Approved Quote",
      member,
      quote(member, "approved"),
      "wrong_status",
    ],
    ["Null Total", member, quote(member, "draft", null), "total_missing"],
    ["Zero Total", member, quote(member, "draft", "0.0000"), "total_zero"],
    ["Negative Total", member, quote(member, "draft", "-5"), "total_negative"],
  ])("%s", (_name, who, facts, expected) => {
    expectDecision(can(who, "quote.submit", facts), expected)
  })
})

// v1 deliberately changed approval: an explicit Approver flag (previously
// Admins and Managers), and self-approval is forbidden.
describe("can(quote.approve / quote.reject)", () => {
  const pending = (owner: Actor) => quote(owner, "pending_approval")
  it.each<Row>([
    ["Approver approves a colleague's Quote", approver, pending(member), true],
    ["Approver approves an Admin's Quote", approver, pending(admin), true],
    [
      "Admin without the flag can't approve",
      admin,
      pending(member),
      "approver_only",
    ],
    [
      "Manager without the flag can't approve",
      manager,
      pending(member),
      "approver_only",
    ],
    ["Manager with the flag approves", managerApprover, pending(member), true],
    [
      "Approver can't approve their own Quote",
      approver,
      pending(approver),
      "self_approval",
    ],
    [
      "Admin Approver can't approve their own Quote",
      adminApprover,
      pending(admin),
      "self_approval",
    ],
    [
      "Only while Pending Approval (Draft)",
      approver,
      quote(member, "draft"),
      "wrong_status",
    ],
    [
      "Only while Pending Approval (Approved)",
      approver,
      quote(member, "approved"),
      "wrong_status",
    ],
  ])("%s", (_name, who, facts, expected) => {
    expectDecision(can(who, "quote.approve", facts), expected)
    expectDecision(can(who, "quote.reject", facts), expected)
  })
})

// Ported from portal rbac.ts (ensureCanRecallQuote).
describe("can(quote.recall)", () => {
  it.each<Row>([
    ["Owner recalls", member, quote(member, "pending_approval"), true],
    ["Admin recalls anyone's", admin, quote(member, "pending_approval"), true],
    [
      "Manager can't recall a Member's",
      manager,
      quote(member, "pending_approval"),
      "owner_or_admin_only",
    ],
    [
      "Approver can't recall someone else's",
      approver,
      quote(member, "pending_approval"),
      "owner_or_admin_only",
    ],
    [
      "Only while Pending Approval",
      member,
      quote(member, "approved"),
      "wrong_status",
    ],
  ])("%s", (_name, who, facts, expected) => {
    expectDecision(can(who, "quote.recall", facts), expected)
  })
})

describe("can(quote.markSent / quote.recordCustomerOutcome)", () => {
  it.each<Row>([
    [
      "Owner marks an Approved Quote as sent",
      member,
      quote(member, "approved"),
      true,
    ],
    ["Admin marks anyone's as sent", admin, quote(member, "approved"), true],
    [
      "Manager can't mark a Member's as sent",
      manager,
      quote(member, "approved"),
      "owner_or_admin_only",
    ],
    ["Only from Approved", member, quote(member, "draft"), "wrong_status"],
    [
      "Not again once sent",
      member,
      quote(member, "pending_customer_approval"),
      "wrong_status",
    ],
  ])("markSent: %s", (_name, who, facts, expected) => {
    expectDecision(can(who, "quote.markSent", facts), expected)
  })

  it.each<Row>([
    [
      "Owner records the outcome",
      member,
      quote(member, "pending_customer_approval"),
      true,
    ],
    [
      "Admin records anyone's outcome",
      admin,
      quote(member, "pending_customer_approval"),
      true,
    ],
    [
      "Member can't record a colleague's",
      otherMember,
      quote(member, "pending_customer_approval"),
      "owner_or_admin_only",
    ],
    [
      "Only from Pending Customer Approval",
      member,
      quote(member, "approved"),
      "wrong_status",
    ],
    [
      "Customer Approved is final",
      admin,
      quote(member, "customer_approved"),
      "wrong_status",
    ],
  ])("recordCustomerOutcome: %s", (_name, who, facts, expected) => {
    expectDecision(can(who, "quote.recordCustomerOutcome", facts), expected)
  })
})

describe("Organization actions are Admin-only", () => {
  it.each(
    ORGANIZATION_ACTIONS.flatMap(
      (action) =>
        [
          [action, admin, true],
          [action, manager, "admin_only"],
          [action, member, "admin_only"],
          [action, approver, "admin_only"],
        ] as const
    )
  )("%s by %o → %s", (action, who, expected) => {
    expectDecision(can(who, action), expected)
  })
})

describe("quotePermissions", () => {
  it("summarises every action for the viewer", () => {
    expect(quotePermissions(member, quote(member))).toEqual({
      canEdit: true,
      canDelete: true,
      canSubmit: true,
      canApprove: false,
      canReject: false,
      canRecall: false,
      canMarkSent: false,
      canRecordCustomerOutcome: false,
      editDenial: null,
    })
  })

  it("explains why a locked Quote can't be edited", () => {
    const p = quotePermissions(admin, quote(member, "pending_approval"))
    expect(p.canEdit).toBe(false)
    expect(p.canRecall).toBe(true)
    expect(p.editDenial?.reason).toBe("locked")
  })

  it("explains the Role rule, and applies the deletable statuses", () => {
    const p = quotePermissions(otherMember, quote(member), {
      deletableStatuses: ["rejected"],
    })
    expect(p.editDenial?.reason).toBe("not_allowed_to_edit")
    expect(
      quotePermissions(member, quote(member), {
        deletableStatuses: ["rejected"],
      }).canDelete
    ).toBe(false)
  })
})
