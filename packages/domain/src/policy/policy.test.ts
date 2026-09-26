import { describe, expect, it } from "vitest"

import { QUOTE_STAGES, type QuoteStage, type Role } from "../enums"
import {
  type Actor,
  can,
  checkDeletableStages,
  DEFAULT_DELETABLE_STAGES,
  DELETABLE_STAGE_OPTIONS,
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
  stage: QuoteStage = "draft",
  total: string | null = "1000.0000"
): QuoteFacts => ({
  ownerId: owner.userId,
  ownerRole: owner.role,
  stage,
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
    ["Draft is editable", member, quote(member, "draft"), true],
    ["In Approval is locked", member, quote(member, "in_approval"), "locked"],
    [
      "Approved is locked even for Admin",
      admin,
      quote(member, "approved"),
      "locked",
    ],
    ["With Customer is locked", admin, quote(admin, "with_customer"), "locked"],
    ["Won is locked", admin, quote(admin, "won"), "locked"],
    ["Lost is locked", admin, quote(admin, "lost"), "locked"],
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
      "Lost isn't deletable by default",
      member,
      quote(member, "lost"),
      "stage_not_deletable",
    ],
    [
      "Approved is never deletable",
      admin,
      quote(admin, "approved"),
      "stage_not_deletable",
    ],
  ])("%s (default settings)", (_name, who, facts, expected) => {
    expectDecision(can(who, "quote.delete", facts), expected)
  })

  it("follows the Organization's deletable Stages", () => {
    const settings = { deletableStages: ["lost"] as QuoteStage[] }
    expectDecision(
      can(member, "quote.delete", quote(member, "lost"), settings),
      true
    )
    expectDecision(
      can(member, "quote.delete", quote(member, "draft"), settings),
      "stage_not_deletable"
    )
  })

  it.each(["in_approval", "approved", "with_customer", "won"] as const)(
    "never deletes a %s Quote, even if settings list it",
    (stage) => {
      const settings = { deletableStages: [...QUOTE_STAGES] }
      expectDecision(
        can(admin, "quote.delete", quote(admin, stage), settings),
        "stage_not_deletable"
      )
    }
  )

  it("offers only Draft and Lost as deletable options", () => {
    expect(DELETABLE_STAGE_OPTIONS).toEqual(["draft", "lost"])
    expect(DEFAULT_DELETABLE_STAGES).toEqual(["draft"])
  })

  it("splits a proposed deletable set into accepted and refused", () => {
    expect(
      checkDeletableStages(["draft", "approved", "draft", "won", "lost"])
    ).toEqual({
      accepted: ["draft", "lost"],
      refused: ["approved", "won"],
    })
  })
})

describe("can(quote.submit)", () => {
  it.each<Row>([
    ["Owner submits a Draft", member, quote(member, "draft"), true],
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
      "Can't submit while In Approval",
      member,
      quote(member, "in_approval"),
      "wrong_stage",
    ],
    [
      "Can't submit an Approved Quote",
      member,
      quote(member, "approved"),
      "wrong_stage",
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
  const pending = (owner: Actor) => quote(owner, "in_approval")
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
      "Only while In Approval (Draft)",
      approver,
      quote(member, "draft"),
      "wrong_stage",
    ],
    [
      "Only while In Approval (Approved)",
      approver,
      quote(member, "approved"),
      "wrong_stage",
    ],
  ])("%s", (_name, who, facts, expected) => {
    expectDecision(can(who, "quote.approve", facts), expected)
    expectDecision(can(who, "quote.reject", facts), expected)
  })
})

// Ported from portal rbac.ts (ensureCanRecallQuote).
describe("can(quote.recall)", () => {
  it.each<Row>([
    ["Owner recalls", member, quote(member, "in_approval"), true],
    ["Admin recalls anyone's", admin, quote(member, "in_approval"), true],
    [
      "Manager can't recall a Member's",
      manager,
      quote(member, "in_approval"),
      "owner_or_admin_only",
    ],
    [
      "Approver can't recall someone else's",
      approver,
      quote(member, "in_approval"),
      "owner_or_admin_only",
    ],
    [
      "Only while In Approval",
      member,
      quote(member, "approved"),
      "wrong_stage",
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
    ["Only from Approved", member, quote(member, "draft"), "wrong_stage"],
    [
      "Not again once sent",
      member,
      quote(member, "with_customer"),
      "wrong_stage",
    ],
  ])("markSent: %s", (_name, who, facts, expected) => {
    expectDecision(can(who, "quote.markSent", facts), expected)
  })

  it.each<Row>([
    ["Owner records the outcome", member, quote(member, "with_customer"), true],
    [
      "Admin records anyone's outcome",
      admin,
      quote(member, "with_customer"),
      true,
    ],
    [
      "Member can't record a colleague's",
      otherMember,
      quote(member, "with_customer"),
      "owner_or_admin_only",
    ],
    [
      "Only from With Customer",
      member,
      quote(member, "approved"),
      "wrong_stage",
    ],
    ["Won is final", admin, quote(member, "won"), "wrong_stage"],
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
      submitDenial: null,
    })
  })

  it("explains why the Owner can't submit", () => {
    const zero = quotePermissions(member, { ...quote(member), total: "0" })
    expect(zero.canSubmit).toBe(false)
    expect(zero.submitDenial?.reason).toBe("total_zero")
    expect(quotePermissions(admin, quote(member)).submitDenial?.reason).toBe(
      "owner_only"
    )
  })

  it("explains why a locked Quote can't be edited", () => {
    const p = quotePermissions(admin, quote(member, "in_approval"))
    expect(p.canEdit).toBe(false)
    expect(p.canRecall).toBe(true)
    expect(p.editDenial?.reason).toBe("locked")
  })

  it("explains the Role rule, and applies the deletable Stages", () => {
    const p = quotePermissions(otherMember, quote(member), {
      deletableStages: ["lost"],
    })
    expect(p.editDenial?.reason).toBe("not_allowed_to_edit")
    expect(
      quotePermissions(member, quote(member), {
        deletableStages: ["lost"],
      }).canDelete
    ).toBe(false)
  })
})
