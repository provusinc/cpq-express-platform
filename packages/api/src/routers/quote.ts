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
  ne,
  or,
  schema,
  sql,
} from "@workspace/db"
import type { OrganizationScope, SQLWrapper } from "@workspace/db"
import { addDays, compareDates } from "@workspace/domain/dates"
import { QUOTE_STATUSES, TIME_PERIODS } from "@workspace/domain/enums"
import { quotePermissions } from "@workspace/domain/policy"
import { QUOTE_NAME_MAX } from "@workspace/domain/quotes"
import { isLocked } from "@workspace/domain/status"

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
import { quoteCommand, quoteFacts } from "../quotes"
import { getOrganizationSettings } from "../settings"
import { createTRPCRouter, organizationProcedure } from "../trpc"
import { quoteApprovalProcedures } from "./quote-approval"
import { quoteCostChangeLogProcedures } from "./quote-cost-change-log"
import { quoteScheduleProcedures } from "./quote-schedule"
import { quoteSummaryProcedures } from "./quote-summary"

const { accounts, lineItems, phases, quotes, users } = schema

/** The longest Description the API accepts. */
const DESCRIPTION_MAX = 2000

/** Columns the Quote list can sort by. */
export const QUOTE_SORT_COLUMNS = [
  "name",
  "account",
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
  account: sql`lower(${accounts.name})`,
  owner: sql`lower(coalesce(${users.name}, ${users.email}))`,
  status: quotes.status,
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

/** The Account a Quote is created for or warned about; NOT_FOUND if not ours. */
async function findAccount(scope: OrganizationScope, accountId: string) {
  const account = await scope.findById(accounts, accountId)
  if (!account) throw notFound("Account")
  return account
}

/** How many of the Account's Quotes are called `name` (ignoring case and spaces). */
async function countSameName(
  scope: OrganizationScope,
  accountId: string,
  name: string,
  exceptId?: string
) {
  const [row] = await scope.db
    .select({ n: count() })
    .from(quotes)
    .where(
      scope.where(
        quotes,
        eq(quotes.accountId, accountId),
        sql`lower(btrim(${quotes.name})) = lower(btrim(${name}))`,
        exceptId ? ne(quotes.id, exceptId) : undefined
      )
    )
  return row?.n ?? 0
}

/** Today's date in UTC, `yyyy-MM-dd`. */
const utcToday = () => new Date().toISOString().slice(0, 10)

/** Valid Until is before today (UTC): highlighted, never a status change. */
const validUntilPassed = (validUntil: string | null, today = utcToday()) =>
  validUntil !== null && compareDates(validUntil, today) < 0

/** Start of the UTC day of an ISO date, for `createdAt` range filters. */
const utcDayStart = (date: string) => new Date(`${date}T00:00:00.000Z`)

const listInput = z
  .object({
    /** Matches Name, Description and the Account's name. */
    search: z.string().trim().max(200).optional(),
    statuses: z
      .array(z.enum(QUOTE_STATUSES))
      .max(QUOTE_STATUSES.length)
      .optional(),
    accountId: z.uuid().optional(),
    /** Created on or after this date (UTC day). */
    createdFrom: isoDateInput.optional(),
    /** Created on or before this date (UTC day). */
    createdTo: isoDateInput.optional(),
    /** `mine`: Quotes the caller owns. */
    owner: z.enum(["all", "mine"]).default("all"),
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
   * One page of the Organization's Quotes with their Account and Owner.
   * Every member sees every Quote; `owner: "mine"` narrows to the caller's.
   * Sorted by `sort` (newest first by default), ties broken by id.
   * `validUntilPassed` is true when Valid Until is before today (UTC),
   * which the list highlights; it never changes the status.
   */
  list: organizationProcedure.input(listInput).query(async ({ ctx, input }) => {
    const search = input.search ? containsPattern(input.search) : undefined
    const where = and(
      ctx.scope.where(
        quotes,
        search
          ? or(
              ilike(quotes.name, search),
              ilike(quotes.description, search),
              ilike(accounts.name, search)
            )
          : undefined,
        input.statuses?.length
          ? inArray(quotes.status, input.statuses)
          : undefined,
        input.accountId ? eq(quotes.accountId, input.accountId) : undefined,
        input.createdFrom
          ? gte(quotes.createdAt, utcDayStart(input.createdFrom))
          : undefined,
        input.createdTo
          ? lt(quotes.createdAt, utcDayStart(addDays(input.createdTo, 1)))
          : undefined,
        input.owner === "mine" ? eq(quotes.ownerId, ctx.user.id) : undefined
      ),
      ctx.scope.where(accounts)
    )
    const direction = input.sort.direction === "asc" ? asc : desc
    const accountJoin = and(
      eq(accounts.organizationId, quotes.organizationId),
      eq(accounts.id, quotes.accountId)
    )
    const [rows, [total]] = await Promise.all([
      ctx.scope.db
        .select({
          id: quotes.id,
          name: quotes.name,
          description: quotes.description,
          status: quotes.status,
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
          account: { id: accounts.id, name: accounts.name },
          owner: { id: users.id, name: users.name, email: users.email },
        })
        .from(quotes)
        .innerJoin(accounts, accountJoin)
        .innerJoin(users, eq(users.id, quotes.ownerId))
        .where(where)
        .orderBy(
          input.sort.by === "validUntil"
            ? sql`${quotes.validUntil} ${sql.raw(input.sort.direction)} nulls last`
            : direction(SORT_EXPRESSIONS[input.sort.by]),
          direction(quotes.id)
        )
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize),
      ctx.scope.db
        .select({ n: count() })
        .from(quotes)
        .innerJoin(accounts, accountJoin)
        .where(where),
    ])
    const today = utcToday()
    return {
      rows: rows.map((row) => ({
        ...row,
        validUntilPassed: validUntilPassed(row.validUntil, today),
      })),
      total: total?.n ?? 0,
      page: input.page,
      pageSize: input.pageSize,
    }
  }),

  /** The Accounts that have Quotes, by name, for the list's Account filter. */
  filterOptions: organizationProcedure.query(async ({ ctx }) => {
    const accountsWithQuotes = await ctx.scope.db
      .selectDistinct({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .innerJoin(
        quotes,
        and(
          eq(quotes.organizationId, accounts.organizationId),
          eq(quotes.accountId, accounts.id)
        )
      )
      .where(ctx.scope.where(accounts))
      .orderBy(asc(accounts.name))
    return { accounts: accountsWithQuotes }
  }),

  /**
   * Whether the Account already has a Quote with this Name (ignoring case
   * and surrounding spaces): the create dialog's non-blocking warning.
   * `exceptId` leaves one Quote out (renaming it). NOT_FOUND for an Account
   * that isn't this Organization's.
   */
  nameTaken: organizationProcedure
    .input(
      z.object({
        accountId: z.uuid(),
        name: z.string().trim().max(QUOTE_NAME_MAX),
        exceptId: z.uuid().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await findAccount(ctx.scope, input.accountId)
      if (!input.name) return { taken: false, count: 0 }
      const n = await countSameName(
        ctx.scope,
        input.accountId,
        input.name,
        input.exceptId
      )
      return { taken: n > 0, count: n }
    }),

  /**
   * Creates a Draft Quote for an unarchived Account, owned by the caller
   * for its whole life, in the Organization's currency. Any member may
   * create Quotes. Returns its id (the editor's URL).
   */
  create: organizationProcedure
    .input(
      z
        .object({
          accountId: z.uuid(),
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
        const account = await findAccount(scope, input.accountId)
        if (account.archived) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `“${account.name}” is archived. Unarchive it to quote it.`,
          })
        }
        const quote = await scope.insert(quotes, {
          accountId: account.id,
          name: input.name,
          description: input.description || null,
          startDate: input.startDate,
          endDate: input.endDate,
          validUntil: input.validUntil ?? null,
          timePeriod: input.timePeriod,
          status: "draft",
          currencyCode: ctx.organization.currencyCode,
          ownerId: ctx.user.id,
          createdById: ctx.user.id,
          updatedById: ctx.user.id,
        })
        return { id: quote.id, name: quote.name }
      })
    ),

  /**
   * One Quote for the editor: its header fields and totals, Account, Owner
   * (and whether they are still a member), who changed it last, and what
   * the caller may do to it (`permissions`, from the domain policy).
   */
  byId: organizationProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const quote = await ctx.scope.findById(quotes, input.id)
      if (!quote) throw notFound("Quote")
      const [account, people, facts, settings] = await Promise.all([
        ctx.scope.findById(accounts, quote.accountId),
        ctx.scope.db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, [quote.ownerId, quote.updatedById])),
        quoteFacts(ctx.scope, quote),
        getOrganizationSettings(ctx.scope),
      ])
      const person = (id: string) => people.find((p) => p.id === id)!
      return {
        id: quote.id,
        name: quote.name,
        description: quote.description,
        status: quote.status,
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
        createdAt: quote.createdAt,
        updatedAt: quote.updatedAt,
        account: {
          id: account!.id,
          name: account!.name,
          archived: account!.archived,
        },
        owner: { ...person(quote.ownerId), isMember: facts.ownerRole !== null },
        updatedBy: person(quote.updatedById),
        locked: isLocked(quote.status),
        permissions: quotePermissions(ctx.actor, facts, {
          deletableStatuses: settings.deletableStatuses,
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
  ...quoteSummaryProcedures,
})
