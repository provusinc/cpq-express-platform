import { index, pgEnum, text, timestamp, uuid } from "drizzle-orm/pg-core"

import { APPROVAL_STEP_ACTIONS } from "@workspace/domain/enums"

import { organizationReference, organizationTable } from "../organization-table"
import { users } from "./auth"
import { quoteStatusEnum } from "./enums"
import { quotes } from "./quotes"

/** Glossary: Approval Step actions, from `@workspace/domain`. */
export const approvalStepActionEnum = pgEnum(
  "approval_step_action",
  APPROVAL_STEP_ACTIONS
)

/**
 * One recorded lifecycle action in a Quote's approval history (glossary:
 * Approval Step): submit, approve, reject, recall, and later Mark as Sent
 * and the customer outcome (#22). Each step records the status it moved the
 * Quote from and to (the domain Status machine decides `toStatus`), who did
 * it and their optional comment. Steps are append-only (never updated) and
 * go with the Quote (cascade); clones never copy them.
 */
export const approvalSteps = organizationTable(
  "approval_steps",
  {
    quoteId: uuid().notNull(),
    action: approvalStepActionEnum().notNull(),
    fromStatus: quoteStatusEnum().notNull(),
    toStatus: quoteStatusEnum().notNull(),
    /** The acting User (global; a removed member stays the actor). */
    actorId: uuid()
      .notNull()
      .references(() => users.id),
    comment: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    organizationReference(t, t.quoteId, quotes).onDelete("cascade"),
    // A Quote's history in order, and its latest submission.
    index().on(t.organizationId, t.quoteId, t.createdAt),
  ]
)

export type ApprovalStep = typeof approvalSteps.$inferSelect
export type NewApprovalStep = typeof approvalSteps.$inferInsert
