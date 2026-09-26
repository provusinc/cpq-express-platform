import { and, eq, inArray } from "drizzle-orm"

import type { ApprovalStepAction, QuoteStage } from "@workspace/domain/enums"
import { QUOTE_STAGES } from "@workspace/domain/enums"
import { nextStage } from "@workspace/domain/stages"

import type { Db } from "../index"
import { organizationScope } from "../organization-scope"
import { stageEntryStatus } from "../quote-statuses"
import { approvalSteps, quotes, users } from "../schema"
import type { Organization } from "../schema"
import { SEED_QUOTES } from "./quotes"
import type { SeedQuoteState } from "./quotes"

/** Who performs an action: the Quote's owner, or the demo Approver. */
type Actor = "owner" | "approver@acme.test"

/**
 * Each seeded state's approval history, oldest first, with how many days
 * ago each step happened (plus the Quote's `historyDaysAgo`). The Approver
 * never decides their own Quote, so the Approver-owned Customer Approved
 * Quote has no history (`noHistory`). A Rejected Draft's history ends with
 * the rejection, which is what makes it Rejected.
 */
const HISTORIES: Partial<
  Record<
    SeedQuoteState,
    {
      action: ApprovalStepAction
      by: Actor
      daysAgo: number
      comment?: string
    }[]
  >
> = {
  in_approval: [
    {
      action: "submit",
      by: "owner",
      daysAgo: 4,
      comment: "Renewal at last year's rates.",
    },
  ],
  approved: [
    { action: "submit", by: "owner", daysAgo: 9 },
    {
      action: "approve",
      by: "approver@acme.test",
      daysAgo: 8,
      comment: "Margin is healthy.",
    },
  ],
  rejected: [
    { action: "submit", by: "owner", daysAgo: 6 },
    {
      action: "reject",
      by: "approver@acme.test",
      daysAgo: 5,
      comment: "Discount is too deep; keep it under 10 %.",
    },
  ],
  with_customer: [
    { action: "submit", by: "owner", daysAgo: 12 },
    { action: "approve", by: "approver@acme.test", daysAgo: 11 },
    { action: "mark_sent", by: "owner", daysAgo: 10 },
  ],
  won: [
    { action: "submit", by: "owner", daysAgo: 30 },
    { action: "approve", by: "approver@acme.test", daysAgo: 29 },
    { action: "mark_sent", by: "owner", daysAgo: 28 },
    {
      action: "customer_approved",
      by: "owner",
      daysAgo: 20,
      comment: "Signed.",
    },
  ],
  customer_rejected: [
    { action: "submit", by: "owner", daysAgo: 30 },
    { action: "approve", by: "approver@acme.test", daysAgo: 29 },
    { action: "mark_sent", by: "owner", daysAgo: 28 },
    {
      action: "customer_rejected",
      by: "owner",
      daysAgo: 14,
      comment: "Went with a cheaper vendor.",
    },
  ],
}

const DAY_MS = 86_400_000

/**
 * Approval Steps for the demo Quotes (`SEED_QUOTES`), consistent with the
 * Stage machine: every seeded Quote's history is replaced on each run. Each
 * step records the Status names the Quote entered each Stage on.
 */
export async function seedApprovalSteps(db: Db, organization: Organization) {
  const organizationId = organization.id
  const [approver] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, "approver@acme.test"))
  if (!approver) throw new Error("Seed Approval Steps: no demo Approver.")
  const scope = organizationScope(db, organizationId)
  const statusNames = Object.fromEntries(
    await Promise.all(
      QUOTE_STAGES.map(
        async (stage) =>
          [stage, (await stageEntryStatus(scope, stage)).name] as const
      )
    )
  ) as Record<QuoteStage, string>
  const now = Date.now()
  for (const seeded of SEED_QUOTES) {
    const [quote] = await db
      .select({ id: quotes.id, ownerId: quotes.ownerId })
      .from(quotes)
      .innerJoin(users, eq(users.id, quotes.ownerId))
      .where(
        and(
          eq(quotes.organizationId, organizationId),
          eq(quotes.name, seeded.name),
          inArray(users.email, [seeded.owner])
        )
      )
    if (!quote) continue
    await db
      .delete(approvalSteps)
      .where(
        and(
          eq(approvalSteps.organizationId, organizationId),
          eq(approvalSteps.quoteId, quote.id)
        )
      )
    let stage: QuoteStage = "draft"
    const history = seeded.noHistory ? [] : (HISTORIES[seeded.state] ?? [])
    const shift = seeded.historyDaysAgo ?? 0
    for (const step of history) {
      const to = nextStage(stage, step.action)
      if (!to) {
        throw new Error(
          `Seed Approval Steps: ${step.action} isn't allowed from ${stage}.`
        )
      }
      await db.insert(approvalSteps).values({
        organizationId,
        quoteId: quote.id,
        action: step.action,
        fromStage: stage,
        toStage: to,
        fromStatusName: statusNames[stage],
        toStatusName: statusNames[to],
        actorId: step.by === "owner" ? quote.ownerId : approver.id,
        comment: step.comment ?? null,
        createdAt: new Date(now - (step.daysAgo + shift) * DAY_MS),
      })
      stage = to
    }
  }
}
