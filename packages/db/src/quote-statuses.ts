/**
 * An Organization's Quote Statuses (ADR-0004): every Organization has at
 * least one per Stage, starting with `DEFAULT_QUOTE_STATUSES`.
 *
 *   await createDefaultQuoteStatuses(organizationScope(tx, organization.id))
 *   const draft = await stageEntryStatus(scope, "draft")
 *
 * Every path that creates an Organization (the Platform Admin console, the
 * seed, the API test fixtures) calls `createDefaultQuoteStatuses`; every
 * command that moves a Quote into a Stage lands it on `stageEntryStatus`.
 * They live in `db` (not `api`) so the seed uses them too.
 */
import { asc, eq } from "drizzle-orm"

import type { QuoteStage } from "@workspace/domain/enums"
import { DEFAULT_QUOTE_STATUSES } from "@workspace/domain/stages"

import type { OrganizationScope } from "./organization-scope"
import { quoteStatuses } from "./schema"

/**
 * Gives the scope's Organization the default Statuses (one per Stage).
 * Idempotent: a Status whose name the Organization already uses is left as
 * it is.
 */
export async function createDefaultQuoteStatuses(scope: OrganizationScope) {
  await scope.db
    .insert(quoteStatuses)
    .values(
      DEFAULT_QUOTE_STATUSES.map((status) => ({
        organizationId: scope.organizationId,
        stage: status.stage,
        name: status.name,
        sequence: 0,
      }))
    )
    .onConflictDoNothing()
}

/**
 * The Status a Quote lands on when it enters `stage`: the Stage's first
 * (lowest sequence, then oldest). Throws if the Organization has none, which
 * the "at least one per Stage" rule rules out.
 */
export async function stageEntryStatus(
  scope: OrganizationScope,
  stage: QuoteStage
): Promise<{ id: string; stage: QuoteStage; name: string }> {
  const [status] = await scope.db
    .select({
      id: quoteStatuses.id,
      stage: quoteStatuses.stage,
      name: quoteStatuses.name,
    })
    .from(quoteStatuses)
    .where(scope.where(quoteStatuses, eq(quoteStatuses.stage, stage)))
    .orderBy(asc(quoteStatuses.sequence), asc(quoteStatuses.id))
    .limit(1)
  if (!status) {
    throw new Error(`The Organization has no Quote Status in Stage ${stage}.`)
  }
  return status
}

/** One Status of the scope's Organization by id, or `undefined`. */
export async function findQuoteStatus(scope: OrganizationScope, id: string) {
  const [status] = await scope.db
    .select({
      id: quoteStatuses.id,
      stage: quoteStatuses.stage,
      name: quoteStatuses.name,
      colour: quoteStatuses.colour,
    })
    .from(quoteStatuses)
    .where(scope.where(quoteStatuses, eq(quoteStatuses.id, id)))
    .limit(1)
  return status
}
