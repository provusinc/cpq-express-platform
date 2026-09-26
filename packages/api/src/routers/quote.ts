import { TRPCError } from "@trpc/server"
import { z } from "zod"

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  lte,
  ne,
  or,
  schema,
  sql,
  stageEntryStatus,
} from "@workspace/db"
import type { OrganizationScope, SQL, SQLWrapper } from "@workspace/db"
import { addDays, compareDates } from "@workspace/domain/dates"
import { QUOTE_STAGES, TIME_PERIODS } from "@workspace/domain/enums"
import type { QuoteStage } from "@workspace/domain/enums"
import { can, quotePermissions } from "@workspace/domain/policy"
import { QUOTE_NAME_MAX } from "@workspace/domain/quotes"
import { toQuantityString } from "@workspace/domain/money"
import { isLocked } from "@workspace/domain/stages"

import { notFound } from "../errors"
import {
  containsPattern,
  isoDateInput,
  money,
  paging,
  percentInput,
  requiredText,
} from "../inputs"
import {
  editorResult,
  lineItemViews,
  quoteMilestones,
  toMilestoneView,
  toPhaseView,
} from "../line-items"
import {
  isQuoteRejected,
  quoteCommand,
  quoteFacts,
  quoteRejected,
} from "../quotes"
import { getOrganizationSettings } from "../settings"
import { createTRPCRouter, organizationProcedure } from "../trpc"
import { quoteApprovalProcedures } from "./quote-approval"
import { quoteCostChangeLogProcedures } from "./quote-cost-change-log"
import { quoteCloneProcedures } from "./quote-clone"
import { quoteDeleteProcedures } from "./quote-delete"
import { marginBelow, quoteInsightsProcedures } from "./quote-insights"
import { quoteScheduleProcedures } from "./quote-schedule"
import { quoteOverviewProcedures } from "./quote-overview"

const { customers, lineItems, phases, quoteStatuses, quotes, users } = schema

/** The longest Description the API accepts. */
const DESCRIPTION_MAX = 2000

/** Columns the Quote list can sort by. */
export const QUOTE_SORT_COLUMNS = [
  "name",
  "customer",
  "owner",
  "status",
  "startDate",
  "endDate",
  "validUntil",
  "timePeriod",
  "total",
  "createdAt",
  "updatedAt",
] as const
export type QuoteSortColumn = (typeof QUOTE_SORT_COLUMNS)[number]

const SORT_EXPRESSIONS: Record<QuoteSortColumn, SQLWrapper> = {
  name: sql`lower(${quotes.name})`,
  customer: sql`lower(${customers.name})`,
  owner: sql`lower(coalesce(${users.name}, ${users.email}))`,
  // Stage order, then the Statuses' order within it (see the list query).
  status: quotes.stage,
  startDate: quotes.startDate,
  endDate: quotes.endDate,
  validUntil: quotes.validUntil,
  timePeriod: quotes.timePeriod,
  total: quotes.total,
  createdAt: quotes.createdAt,
  updatedAt: quotes.updatedAt,
}

/** A Quote Start/End Date pair with End on or after Start. */
function refineDates(
  value: { startDate: string; endDate: string },
  ctx: z.RefinementCtx
) {
  if (compareDates(value.endDate, value.startDate) < 0) {
    ctx.addIssue({
      code: "custom",
      path: ["endDate"],
      message: "The end date can't be before the start date.",
    })
  }
}

/** The Customer a Quote is created for or warned about; NOT_FOUND if not ours. */
async function findCustomer(scope: OrganizationScope, customerId: string) {
  const customer = await scope.findById(customers, customerId)
  if (!customer) throw notFound("Customer")
  return customer
}

/** How many of the Customer's Quotes are called `name` (ignoring case and spaces). */
async function countSameName(
  scope: OrganizationScope,
  customerId: string,
  name: string,
  exceptId?: string
) {
  const [row] = await scope.db
    .select({ n: count() })
    .from(quotes)
    .where(
      scope.where(
        quotes,
        eq(quotes.customerId, customerId),
        sql`lower(btrim(${quotes.name})) = lower(btrim(${name}))`,
        exceptId ? ne(quotes.id, exceptId) : undefined
      )
    )
  return row?.n ?? 0
}

/** Today's date in UTC, `yyyy-MM-dd`. */
const utcToday = () => new Date().toISOString().slice(0, 10)

/** Valid Until is before today (UTC): highlighted, never a Stage change. */
const validUntilPassed = (validUntil: string | null, today = utcToday()) =>
  validUntil !== null && compareDates(validUntil, today) < 0

/** Start of the UTC day of an ISO date, for `createdAt` range filters. */
const utcDayStart = (date: string) => new Date(`${date}T00:00:00.000Z`)

const listInput = z
  .object({
    /** Matches Name, Description and the Customer's name. */
    search: z.string().trim().max(200).optional(),
    /** In one of these Quote Stages (the Dashboard's `?status=<stage>`). */
    stages: z.array(z.enum(QUOTE_STAGES)).max(QUOTE_STAGES.length).optional(),
    /** In one of these Quote Statuses (the list's Status filter). */
    statusIds: z.array(z.uuid()).max(100).optional(),
    /** `true`: only Rejected Quotes; `false`: none of them. */
    rejected: z.boolean().optional(),
    customerId: z.uuid().optional(),
    /** Created on or after this date (UTC day). */
    createdFrom: isoDateInput.optional(),
    /** Created on or before this date (UTC day). */
    createdTo: isoDateInput.optional(),
    /** Valid Until on or after this date. */
    validUntilFrom: isoDateInput.optional(),
    /** Valid Until on or before this date. */
    validUntilTo: isoDateInput.optional(),
    /** `mine`: Quotes the caller owns. */
    owner: z.enum(["all", "mine"]).default("all"),
    /**
     * Margin % below this, among Quotes with a positive Total (the Low
     * margin Key Insight's rule; an empty Quote has no meaningful margin).
     */
    marginBelow: percentInput.optional(),
    sort: z
      .object({
        by: z.enum(QUOTE_SORT_COLUMNS),
        direction: z.enum(["asc", "desc"]),
      })
      .default({ by: "createdAt", direction: "desc" }),
    ...paging,
  })
  .superRefine((value, ctx) => {
    if (
      value.createdFrom &&
      value.createdTo &&
      compareDates(value.createdTo, value.createdFrom) < 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["createdTo"],
        message: "The range ends before it starts.",
      })
    }
  })

export const quoteRouter = createTRPCRouter({
  /**
   * One page of the Organization's Quotes with their Customer and Owner.
   * Every member sees every Quote; `owner: "mine"` narrows to the caller's.
   * Sorted by `sort` (newest first by default; `status` sorts by Stage,
   * then the Status's order in it), ties broken by id. Each row has its
   * `stage`, its `status` (the Organization's Quote Status: id, name,
   * colour) and `rejected` (a Draft whose latest Approval Step is a
   * rejection). `validUntilPassed` is true when Valid Until is before today
   * (UTC), which the list highlights; it never changes the Stage.
   * `canDelete` is whether the caller may delete the row (its menu and
   * bulk delete). `stageCounts` counts every Stage under all the other
   * filters; `total` is the count under every filter.
   */
  list: organizationProcedure.input(listInput).query(async ({ ctx, input }) => {
    const search = input.search ? containsPattern(input.search) : undefined
    // Every filter but the Stage and Status: `stageCounts` count under these.
    const filters = (stageFilters = false) =>
      and(
        ctx.scope.where(
          quotes,
          search
            ? or(
                ilike(quotes.name, search),
                ilike(quotes.description, search),
                ilike(customers.name, search)
              )
            : undefined,
          stageFilters && input.stages?.length
            ? inArray(quotes.stage, input.stages)
            : undefined,
          stageFilters && input.statusIds?.length
            ? inArray(quotes.statusId, input.statusIds)
            : undefined,
          input.rejected === undefined
            ? undefined
            : input.rejected
              ? quoteRejected
              : sql`not ${quoteRejected}`,
          input.customerId
            ? eq(quotes.customerId, input.customerId)
            : undefined,
          input.createdFrom
            ? gte(quotes.createdAt, utcDayStart(input.createdFrom))
            : undefined,
          input.createdTo
            ? lt(quotes.createdAt, utcDayStart(addDays(input.createdTo, 1)))
            : undefined,
          input.validUntilFrom
            ? gte(quotes.validUntil, input.validUntilFrom)
            : undefined,
          input.validUntilTo
            ? lte(quotes.validUntil, input.validUntilTo)
            : undefined,
          input.owner === "mine" ? eq(quotes.ownerId, ctx.user.id) : undefined,
          input.marginBelow !== undefined
            ? marginBelow(input.marginBelow)
            : undefined
        ),
        ctx.scope.where(customers)
      ) as SQL
    const where = filters(true)
    const direction = input.sort.direction === "asc" ? asc : desc
    const customerJoin = and(
      eq(customers.organizationId, quotes.organizationId),
      eq(customers.id, quotes.customerId)
    )
    const statusJoin = and(
      eq(quoteStatuses.organizationId, quotes.organizationId),
      eq(quoteStatuses.id, quotes.statusId)
    )
    const [rows, byStatus, settings] = await Promise.all([
      ctx.scope.db
        .select({
          id: quotes.id,
          name: quotes.name,
          description: quotes.description,
          stage: quotes.stage,
          status: {
            id: quoteStatuses.id,
            name: quoteStatuses.name,
            colour: quoteStatuses.colour,
          },
          rejected: quoteRejected,
          startDate: quotes.startDate,
          endDate: quotes.endDate,
          validUntil: quotes.validUntil,
          timePeriod: quotes.timePeriod,
          currencyCode: quotes.currencyCode,
          subtotal: quotes.subtotal,
          total: quotes.total,
          marginPct: quotes.marginPct,
          createdAt: quotes.createdAt,
          updatedAt: quotes.updatedAt,
          customer: {
            id: customers.id,
            name: customers.name,
            archived: customers.archived,
          },
          owner: { id: users.id, name: users.name, email: users.email },
        })
        .from(quotes)
        .innerJoin(customers, customerJoin)
        .innerJoin(users, eq(users.id, quotes.ownerId))
        .innerJoin(quoteStatuses, statusJoin)
        .where(where)
        .orderBy(
          input.sort.by === "validUntil"
            ? sql`${quotes.validUntil} ${sql.raw(input.sort.direction)} nulls last`
            : direction(SORT_EXPRESSIONS[input.sort.by]),
          ...(input.sort.by === "status"
            ? [
                direction(quoteStatuses.sequence),
                direction(sql`lower(${quoteStatuses.name})`),
              ]
            : []),
          direction(quotes.id)
        )
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize),
      // Counts per Stage and Status under every other filter; the total is
      // the sum over the Stages and Statuses asked for.
      ctx.scope.db
        .select({ stage: quotes.stage, statusId: quotes.statusId, n: count() })
        .from(quotes)
        .innerJoin(customers, customerJoin)
        .where(filters())
        .groupBy(quotes.stage, quotes.statusId),
      getOrganizationSettings(ctx.scope),
    ])
    const today = utcToday()
    return {
      rows: rows.map((row) => ({
        ...row,
        validUntilPassed: validUntilPassed(row.validUntil, today),
        // Delete reads only the owner and Stage (never the owner's Role).
        canDelete: can(
          ctx.actor,
          "quote.delete",
          { ownerId: row.owner.id, ownerRole: null, stage: row.stage },
          { deletableStages: settings.deletableStages }
        ).allowed,
      })),
      total: byStatus
        .filter(
          (s) =>
            (!input.stages?.length || input.stages.includes(s.stage)) &&
            (!input.statusIds?.length || input.statusIds.includes(s.statusId))
        )
        .reduce((sum, s) => sum + s.n, 0),
      /** Every Stage's count under the other filters. */
      stageCounts: Object.fromEntries(
        QUOTE_STAGES.map((stage) => [
          stage,
          byStatus
            .filter((s) => s.stage === stage)
            .reduce((sum, s) => sum + s.n, 0),
        ])
      ) as Record<QuoteStage, number>,
      page: input.page,
      pageSize: input.pageSize,
    }
  }),

  /** The Customers that have Quotes, by name, for the list's Customer filter. */
  filterOptions: organizationProcedure.query(async ({ ctx }) => {
    const customersWithQuotes = await ctx.scope.db
      .selectDistinct({ id: customers.id, name: customers.name })
      .from(customers)
      .innerJoin(
        quotes,
        and(
          eq(quotes.organizationId, customers.organizationId),
          eq(quotes.customerId, customers.id)
        )
      )
      .where(ctx.scope.where(customers))
      .orderBy(asc(customers.name))
    return { customers: customersWithQuotes }
  }),

  /**
   * Whether the Customer already has a Quote with this Name (ignoring case
   * and surrounding spaces): the create dialog's non-blocking warning.
   * `exceptId` leaves one Quote out (renaming it). NOT_FOUND for a Customer
   * that isn't this Organization's.
   */
  nameTaken: organizationProcedure
    .input(
      z.object({
        customerId: z.uuid(),
        name: z.string().trim().max(QUOTE_NAME_MAX),
        exceptId: z.uuid().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await findCustomer(ctx.scope, input.customerId)
      if (!input.name) return { taken: false, count: 0 }
      const n = await countSameName(
        ctx.scope,
        input.customerId,
        input.name,
        input.exceptId
      )
      return { taken: n > 0, count: n }
    }),

  /**
   * Creates a Draft Quote for an unarchived Customer, owned by the caller
   * for its whole life, in the Organization's currency. Any member may
   * create Quotes. Returns its id (the editor's URL).
   */
  create: organizationProcedure
    .input(
      z
        .object({
          customerId: z.uuid(),
          name: requiredText(QUOTE_NAME_MAX),
          description: z.string().trim().max(DESCRIPTION_MAX).optional(),
          startDate: isoDateInput,
          endDate: isoDateInput,
          validUntil: isoDateInput.nullish(),
          timePeriod: z.enum(TIME_PERIODS),
        })
        .superRefine(refineDates)
    )
    .mutation(({ ctx, input }) =>
      ctx.scope.transaction(async (scope) => {
        const customer = await findCustomer(scope, input.customerId)
        if (customer.archived) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `“${customer.name}” is archived. Unarchive it to quote it.`,
          })
        }
        const draft = await stageEntryStatus(scope, "draft")
        const quote = await scope.insert(quotes, {
          customerId: customer.id,
          name: input.name,
          description: input.description || null,
          startDate: input.startDate,
          endDate: input.endDate,
          validUntil: input.validUntil ?? null,
          timePeriod: input.timePeriod,
          stage: "draft",
          statusId: draft.id,
          currencyCode: ctx.organization.currencyCode,
          ownerId: ctx.user.id,
          createdById: ctx.user.id,
          updatedById: ctx.user.id,
        })
        return { id: quote.id, name: quote.name }
      })
    ),

  /**
   * One Quote for the editor: its header fields and totals, its Effort in
   * hours (Σ quantity of the hourly Line Items), Customer, Owner
   * (and whether they are still a member), who changed it last, its Stage
   * and Quote Status, the Statuses of its Stage in order (`stageStatuses`,
   * what the header's Status menu offers), whether it is Rejected, and what
   * the caller may do to it (`permissions`, from the domain policy).
   */
  byId: organizationProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const quote = await ctx.scope.findById(quotes, input.id)
      if (!quote) throw notFound("Quote")
      const [
        customer,
        people,
        facts,
        settings,
        [effort],
        status,
        rejected,
        stageStatuses,
      ] = await Promise.all([
        ctx.scope.findById(customers, quote.customerId),
        ctx.scope.db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, [quote.ownerId, quote.updatedById])),
        quoteFacts(ctx.scope, quote),
        getOrganizationSettings(ctx.scope),
        ctx.scope.db
          .select({
            hours: sql<string>`coalesce(sum(${lineItems.quantity}), 0)`,
          })
          .from(lineItems)
          .where(
            ctx.scope.where(
              lineItems,
              eq(lineItems.quoteId, quote.id),
              eq(lineItems.billingUnit, "hour")
            )
          ),
        ctx.scope.findById(quoteStatuses, quote.statusId),
        isQuoteRejected(ctx.scope, quote.id),
        ctx.scope.db
          .select({
            id: quoteStatuses.id,
            name: quoteStatuses.name,
            colour: quoteStatuses.colour,
          })
          .from(quoteStatuses)
          .where(
            ctx.scope.where(quoteStatuses, eq(quoteStatuses.stage, quote.stage))
          )
          .orderBy(asc(quoteStatuses.sequence), asc(quoteStatuses.id)),
      ])
      const person = (id: string) => people.find((p) => p.id === id)!
      return {
        id: quote.id,
        name: quote.name,
        description: quote.description,
        stage: quote.stage,
        status: {
          id: status!.id,
          name: status!.name,
          colour: status!.colour,
        },
        rejected,
        stageStatuses,
        startDate: quote.startDate,
        endDate: quote.endDate,
        validUntil: quote.validUntil,
        validUntilPassed: validUntilPassed(quote.validUntil),
        timePeriod: quote.timePeriod,
        currencyCode: quote.currencyCode,
        discountKind: quote.discountKind,
        discountValue: quote.discountValue,
        subtotal: quote.subtotal,
        discountAmount: quote.discountAmount,
        total: quote.total,
        cost: quote.cost,
        margin: quote.margin,
        marginPct: quote.marginPct,
        effortHours: toQuantityString(effort?.hours ?? 0),
        createdAt: quote.createdAt,
        updatedAt: quote.updatedAt,
        customer: {
          id: customer!.id,
          name: customer!.name,
          archived: customer!.archived,
        },
        owner: { ...person(quote.ownerId), isMember: facts.ownerRole !== null },
        updatedBy: person(quote.updatedById),
        locked: isLocked(quote.stage),
        permissions: quotePermissions(ctx.actor, facts, {
          deletableStages: settings.deletableStages,
        }),
      }
    }),

  /**
   * What the Quote editor's grid, Timeline and Summary show: the Phases,
   * every Line Item (sequence, then id), the Milestones (by date) and the
   * Quote's server-computed totals. Every member may read it. Editor commands return the same
   * pieces (`EditorResult`), which the client merges into this query.
   */
  editor: organizationProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const quote = await ctx.scope.findById(quotes, input.id)
      if (!quote) throw notFound("Quote")
      const [phaseRows, lineRows, milestoneRows] = await Promise.all([
        ctx.scope.findMany(phases, {
          where: eq(phases.quoteId, quote.id),
          orderBy: [asc(phases.sequence), asc(phases.id)],
        }),
        ctx.scope.findMany(lineItems, {
          where: eq(lineItems.quoteId, quote.id),
          orderBy: [asc(lineItems.sequence), asc(lineItems.id)],
        }),
        quoteMilestones(ctx.scope, quote.id),
      ])
      return {
        quoteId: quote.id,
        phases: phaseRows.map(toPhaseView),
        lines: await lineItemViews(ctx.scope, lineRows),
        milestones: milestoneRows.map(toMilestoneView),
        totals: {
          currencyCode: quote.currencyCode,
          discountKind: quote.discountKind,
          discountValue: quote.discountValue,
          subtotal: quote.subtotal,
          discountAmount: quote.discountAmount,
          total: quote.total,
          cost: quote.cost,
          margin: quote.margin,
          marginPct: quote.marginPct,
          updatedAt: quote.updatedAt,
          updatedById: quote.updatedById,
        },
      }
    }),

  /**
   * Sets the Quote Discount as entered — a percentage of the Subtotal (0 to
   * 100) or a fixed amount — or clears it (`null`). Whichever was entered
   * stays authoritative as lines change; the amount is derived and capped at
   * the Subtotal, so the Total never goes below 0. Returns the standard
   * editor result with the new totals.
   */
  setDiscount: organizationProcedure
    .input(
      z.object({
        id: z.uuid(),
        discount: z
          .discriminatedUnion("kind", [
            z.object({ kind: z.literal("percent"), value: percentInput }),
            z.object({ kind: z.literal("amount"), value: money }),
          ])
          .nullable(),
      })
    )
    .mutation(({ ctx, input }) =>
      quoteCommand(ctx, input.id, "quote.edit", async (cmd) => {
        await cmd.update({
          discountKind: input.discount?.kind ?? null,
          discountValue: input.discount?.value ?? null,
        })
        return editorResult(cmd, {})
      })
    ),

  /** `setDates` and `setTimePeriod` (see ./quote-schedule.ts). */
  ...quoteScheduleProcedures,

  /** `clone` (see ./quote-clone.ts). */
  ...quoteCloneProcedures,

  /** `delete` and `deleteMany` (see ./quote-delete.ts). */
  ...quoteDeleteProcedures,

  /** Renames the Quote (Name only). Needs edit permission and an unlocked Quote. */
  rename: organizationProcedure
    .input(z.object({ id: z.uuid(), name: requiredText(QUOTE_NAME_MAX) }))
    .mutation(({ ctx, input }) =>
      quoteCommand(ctx, input.id, "quote.edit", async (cmd) => {
        const quote = await cmd.update({ name: input.name })
        return {
          id: quote.id,
          name: quote.name,
          updatedAt: quote.updatedAt,
          updatedById: quote.updatedById,
        }
      })
    ),

  /** Sets or clears (blank) the Description only. Same rules as rename. */
  setDescription: organizationProcedure
    .input(
      z.object({
        id: z.uuid(),
        description: z.string().trim().max(DESCRIPTION_MAX).nullable(),
      })
    )
    .mutation(({ ctx, input }) =>
      quoteCommand(ctx, input.id, "quote.edit", async (cmd) => {
        const quote = await cmd.update({
          description: input.description || null,
        })
        return {
          id: quote.id,
          description: quote.description,
          updatedAt: quote.updatedAt,
          updatedById: quote.updatedById,
        }
      })
    ),

  /** Submit, approve, reject, recall and the approval reads (./quote-approval.ts). */
  ...quoteApprovalProcedures,

  /** The cost change log (./quote-cost-change-log.ts). */
  ...quoteCostChangeLogProcedures,

  /** The Summary and Financials reads (./quote-summary.ts). */
  ...quoteOverviewProcedures,

  /** The Key Insights above the Quote list (./quote-insights.ts). */
  ...quoteInsightsProcedures,
})
