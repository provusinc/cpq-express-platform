/**
 * Loading a Quote for a command (ADR-0003: one command per gesture, each in
 * one transaction that re-checks permission and the lock).
 *
 * Every Quote command goes through `quoteCommand`:
 *
 *   rename: organizationProcedure
 *     .input(z.object({ id: z.uuid(), name: requiredText(QUOTE_NAME_MAX) }))
 *     .mutation(({ ctx, input }) =>
 *       quoteCommand(ctx, input.id, "quote.edit", async (cmd) => {
 *         const quote = await cmd.update({ name: input.name })
 *         return { id: quote.id, name: quote.name, … }
 *       })
 *     )
 *
 * `quoteCommand(ctx, quoteId, action, fn)` opens a transaction, then
 * `loadQuoteForCommand`:
 * 1. loads the Quote through the Organization scope and locks its row
 *    (`FOR UPDATE`), so concurrent commands on one Quote run one after the
 *    other (totals recomputation, Document versions) — NOT_FOUND when the id
 *    isn't this Organization's;
 * 2. builds the policy's `QuoteFacts` (`ownerRole` is the owner's current
 *    Membership Role, `null` once they were removed) and, for
 *    `quote.delete`, reads the Organization's deletable Stages;
 * 3. asks `can(actor, action, facts, settings)` and turns a refusal into
 *    FORBIDDEN (who is asking: Role, owner, Approver rules) or
 *    PRECONDITION_FAILED (the Quote's state: locked, wrong Stage, not
 *    deletable, Total not positive), with the policy's message.
 *
 * `fn` then receives a `QuoteCommand`: the transaction's `scope`, the locked
 * `quote` row, its `facts`, the `actor`, and `update(changes)`, which writes
 * only the given fields plus `updatedById` (last write wins per field) and
 * returns the updated row, and `reprice()`, which runs
 * `recomputeQuoteTotals` (domain pricing over the current Line Items and
 * Quote Discount, persisted) and returns the new totals and lines. Commands
 * that change money reprice in the same `fn` before returning (ADR-0002) —
 * usually through `editorResult(cmd, …)` from `./line-items`, which builds
 * the standard `{ lines, deletedLineIds, totals }` result.
 */
import { TRPCError } from "@trpc/server"

import { eq, recomputeQuoteTotals, schema, sql } from "@workspace/db"
import type { OrganizationScope, RecomputeResult, SQL } from "@workspace/db"
import type { Role } from "@workspace/domain/enums"
import {
  REJECTION_ACTIONS,
  STATUS_CHANGE_ACTION,
} from "@workspace/domain/stages"
import { can } from "@workspace/domain/policy"
import type {
  Actor,
  Decision,
  DenialReason,
  PolicySettings,
  QuoteAction,
  QuoteFacts,
} from "@workspace/domain/policy"

import { notFound } from "./errors"
import { getOrganizationSettings } from "./settings"

const { memberships, quotes } = schema

export type QuoteRow = typeof quotes.$inferSelect
type QuoteChanges = Partial<
  Omit<
    typeof quotes.$inferInsert,
    | "id"
    | "organizationId"
    | "ownerId"
    | "createdById"
    | "updatedById"
    | "currencyCode"
  >
>

/** What a Quote command's body works with (see the module comment). */
export interface QuoteCommand {
  /** The command's transaction, scoped to the Organization. */
  scope: OrganizationScope
  /** The Quote as loaded (row locked until the transaction ends). */
  quote: QuoteRow
  facts: QuoteFacts
  actor: Actor
  /**
   * Writes only `changes` (plus `updatedById` = the actor) and returns the
   * updated row. The owner, creator and currency never change.
   */
  update(changes: QuoteChanges): Promise<QuoteRow>
  /**
   * Recomputes and persists the Quote's money from its current Line Items
   * and Quote Discount (`recomputeQuoteTotals`, also setting `updatedById`)
   * and returns the new totals and every line as stored.
   */
  reprice(): Promise<RecomputeResult>
}

/** Refusals about the Quote's state rather than about who is asking. */
const PRECONDITION_REASONS: readonly DenialReason[] = [
  "locked",
  "wrong_stage",
  "stage_not_deletable",
  "total_missing",
  "total_zero",
  "total_negative",
]

/** The tRPC error for a policy refusal: PRECONDITION_FAILED or FORBIDDEN. */
export function denialError(
  decision: Extract<Decision, { allowed: false }>
): TRPCError {
  return new TRPCError({
    code: PRECONDITION_REASONS.includes(decision.reason)
      ? "PRECONDITION_FAILED"
      : "FORBIDDEN",
    message: decision.message,
  })
}

/** The owner's current Role in the scope's Organization, or null if removed. */
export async function ownerRole(
  scope: OrganizationScope,
  ownerId: string
): Promise<Role | null> {
  const [membership] = await scope.db
    .select({ role: memberships.role })
    .from(memberships)
    .where(scope.where(memberships, eq(memberships.userId, ownerId)))
    .limit(1)
  return membership?.role ?? null
}

/** The policy's facts about `quote`. */
export async function quoteFacts(
  scope: OrganizationScope,
  quote: Pick<QuoteRow, "ownerId" | "stage" | "total">
): Promise<QuoteFacts> {
  return {
    ownerId: quote.ownerId,
    ownerRole: await ownerRole(scope, quote.ownerId),
    stage: quote.stage,
    total: quote.total,
  }
}

/**
 * Glossary: Rejected, in SQL, for the `quotes` row of the surrounding query:
 * the Quote is in Draft and its latest Approval Step, status changes
 * skipped, is a rejection (by an Approver or the customer; the domain's
 * `isRejected`). Select it
 * (`rejected: quoteRejected`) or filter by it. Qualified by hand: drizzle
 * leaves columns bare in a single-table query, which the correlated
 * subquery would misread.
 */
export const quoteRejected: SQL<boolean> = sql<boolean>`("quotes"."stage" = 'draft' and coalesce((
  select latest."action" in (${sql.join(
    REJECTION_ACTIONS.map((action) => sql`${action}`),
    sql`, `
  )})
  from "approval_steps" latest
  where latest."organization_id" = "quotes"."organization_id"
    and latest."quote_id" = "quotes"."id"
    and latest."action" <> ${STATUS_CHANGE_ACTION}
  order by latest."created_at" desc, latest."id" desc
  limit 1
), false))`

/** Whether one Quote is Rejected (`quoteRejected` for a single row). */
export async function isQuoteRejected(
  scope: OrganizationScope,
  quoteId: string
): Promise<boolean> {
  const [row] = await scope.db
    .select({ rejected: quoteRejected })
    .from(quotes)
    .where(scope.where(quotes, eq(quotes.id, quoteId)))
  return row?.rejected ?? false
}

/** The settings `can` reads for `action` (only delete needs any). */
async function policySettings(
  scope: OrganizationScope,
  action: QuoteAction
): Promise<PolicySettings | undefined> {
  if (action !== "quote.delete") return undefined
  const { deletableStages } = await getOrganizationSettings(scope)
  return { deletableStages }
}

/**
 * Loads and locks the Quote and checks `action` (steps 1–3 of the module
 * comment). Call it inside a transaction — `quoteCommand` does — so the row
 * lock lasts for the whole command.
 */
export async function loadQuoteForCommand(
  scope: OrganizationScope,
  actor: Actor,
  quoteId: string,
  action: QuoteAction
): Promise<{ quote: QuoteRow; facts: QuoteFacts }> {
  const [quote] = await scope.db
    .select()
    .from(quotes)
    .where(scope.where(quotes, eq(quotes.id, quoteId)))
    .limit(1)
    .for("update")
  if (!quote) throw notFound("Quote")
  const facts = await quoteFacts(scope, quote)
  const decision = can(
    actor,
    action,
    facts,
    await policySettings(scope, action)
  )
  if (!decision.allowed) throw denialError(decision)
  return { quote, facts }
}

/**
 * Runs one Quote command: a transaction, `loadQuoteForCommand`, then `fn`
 * (see the module comment). `ctx` is the organization tier's context.
 */
export function quoteCommand<T>(
  ctx: { scope: OrganizationScope; actor: Actor },
  quoteId: string,
  action: QuoteAction,
  fn: (cmd: QuoteCommand) => Promise<T>
): Promise<T> {
  return ctx.scope.transaction(async (scope) => {
    const { quote, facts } = await loadQuoteForCommand(
      scope,
      ctx.actor,
      quoteId,
      action
    )
    const update = async (changes: QuoteChanges) => {
      const [row] = await scope.db
        .update(quotes)
        .set({ ...changes, updatedById: ctx.actor.userId })
        .where(scope.where(quotes, eq(quotes.id, quote.id)))
        .returning()
      return row!
    }
    const reprice = () =>
      recomputeQuoteTotals(scope, quote.id, { updatedById: ctx.actor.userId })
    return fn({ scope, quote, facts, actor: ctx.actor, update, reprice })
  })
}
