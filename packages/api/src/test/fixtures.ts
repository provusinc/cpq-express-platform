import { randomBytes } from "node:crypto"

import type { SessionUser } from "@workspace/auth"
import { QUOTE_STAGES } from "@workspace/domain/enums"
import type {
  ApprovalStepAction,
  CustomerClassificationKind,
  QuoteStage,
  Role,
} from "@workspace/domain/enums"
import { nextStage } from "@workspace/domain/stages"
import {
  createDefaultCatalogTypes,
  createDefaultCustomerClassifications,
  createDefaultQuoteStatuses,
  createInvitationToken,
  ensureCustomerClassification,
  eq,
  organizationScope,
  schema,
  stageEntryStatus,
  sql,
  uuidv7,
} from "@workspace/db"
import type { Db } from "@workspace/db"

type NewUser = typeof schema.users.$inferInsert

/** Inserts a User (unique email by default). Returns the full row. */
export async function createUser(db: Db, overrides: Partial<NewUser> = {}) {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `user-${uuidv7()}@example.test`,
      name: "Test User",
      emailVerified: new Date(),
      ...overrides,
    })
    .returning()
  return user!
}

/**
 * Inserts a database session for `user`, as Auth.js does after sign-in.
 * `cookie` is a ready-made `Cookie` header value for `createTestCaller`'s
 * `headers`, to exercise the real cookie → session path.
 */
export async function createSession(
  db: Db,
  user: { id: string },
  { expires = new Date(Date.now() + 24 * 60 * 60 * 1000) } = {}
) {
  const sessionToken = randomBytes(32).toString("hex")
  await db
    .insert(schema.sessions)
    .values({ sessionToken, userId: user.id, expires })
  return {
    sessionToken,
    expires,
    cookie: `authjs.session-token=${sessionToken}`,
  }
}

/** Narrows a users row (or any superset) to the shape carried in the session. */
export function toSessionUser(user: SessionUser): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    isPlatformAdmin: user.isPlatformAdmin,
  }
}

type NewOrganization = typeof schema.organizations.$inferInsert

/**
 * Inserts an Organization (unique slug by default, USD) with the default
 * Quote Statuses, Customer Types and Industries, like the Platform Admin console. Returns the row.
 */
export async function createOrganization(
  db: Db,
  overrides: Partial<NewOrganization> = {}
) {
  const suffix = uuidv7().slice(-12)
  const [organization] = await db
    .insert(schema.organizations)
    .values({
      slug: `org-${suffix}`,
      name: `Organization ${suffix}`,
      currencyCode: "USD",
      ...overrides,
    })
    .returning()
  await createDefaultQuoteStatuses(organizationScope(db, organization!.id))
  await createDefaultCustomerClassifications(
    organizationScope(db, organization!.id)
  )
  await createDefaultCatalogTypes(organizationScope(db, organization!.id))
  return organization!
}

/** Gives `user` a Membership in `organization` (Role Member by default). */
export async function createMembership(
  db: Db,
  {
    organization,
    user,
    role = "member",
    isApprover = false,
  }: {
    organization: { id: string }
    user: { id: string }
    role?: Role
    isApprover?: boolean
  }
) {
  const [membership] = await db
    .insert(schema.memberships)
    .values({
      organizationId: organization.id,
      userId: user.id,
      role,
      isApprover,
    })
    .returning()
  return membership!
}

/**
 * A new User holding a Membership in `organization`: the usual way to get a
 * caller for an Organization-tier test.
 *
 *   const { user } = await createMember(db, acme, { role: "admin" })
 *   const caller = organizationCaller(db, { organization: acme, user })
 */
export async function createMember(
  db: Db,
  organization: { id: string },
  {
    role,
    isApprover,
    user: userOverrides,
  }: { role?: Role; isApprover?: boolean; user?: Partial<NewUser> } = {}
) {
  const user = await createUser(db, userOverrides)
  const membership = await createMembership(db, {
    organization,
    user,
    role,
    isApprover,
  })
  return { user, membership }
}

type NewInvitation = typeof schema.invitations.$inferInsert

/**
 * Inserts an Invitation directly (no email) and returns it with its raw
 * `token`. Pending for a week by default; pass `expiresAt`, `acceptedAt` or
 * `revokedAt` for the other outcomes.
 */
export async function createInvitation(
  db: Db,
  {
    organization,
    email = `invitee-${uuidv7()}@example.test`,
    role = "member",
    ...overrides
  }: { organization: { id: string }; email?: string; role?: Role } & Partial<
    Omit<NewInvitation, "organizationId" | "email" | "role" | "tokenHash">
  >
) {
  const { token, tokenHash } = createInvitationToken()
  const [invitation] = await db
    .insert(schema.invitations)
    .values({
      organizationId: organization.id,
      email: email.toLowerCase(),
      role,
      tokenHash,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ...overrides,
    })
    .returning()
  return { invitation: invitation!, token }
}

type NewCustomer = Omit<typeof schema.customers.$inferInsert, "organizationId">

/** Inserts a Customer in `organization` (unique name by default). */
export async function createCustomer(
  db: Db,
  organization: { id: string },
  overrides: Partial<NewCustomer> = {}
) {
  const [customer] = await db
    .insert(schema.customers)
    .values({
      name: `Customer ${uuidv7().slice(-12)}`,
      ...overrides,
      organizationId: organization.id,
    })
    .returning()
  return customer!
}

/**
 * The id of the Organization's Customer Type or Industry named `name`
 * (ignoring case), created at the end of its list when missing; with
 * `retired`, retired too.
 */
export async function customerClassification(
  db: Db,
  organization: { id: string },
  kind: CustomerClassificationKind,
  name: string,
  { retired = false }: { retired?: boolean } = {}
) {
  const scope = organizationScope(db, organization.id)
  const id = await ensureCustomerClassification(scope, kind, name)
  if (retired) {
    await scope.update(schema.customerClassifications, id, {
      retiredAt: new Date(),
    })
  }
  return id
}

type NewContact = Omit<
  typeof schema.contacts.$inferInsert,
  "organizationId" | "customerId"
>

/** Inserts a Contact at `customer` (not primary unless `isPrimary`). */
export async function createContact(
  db: Db,
  customer: { id: string; organizationId: string },
  overrides: Partial<NewContact> = {}
) {
  const [contact] = await db
    .insert(schema.contacts)
    .values({
      name: "Casey Contact",
      ...overrides,
      organizationId: customer.organizationId,
      customerId: customer.id,
    })
    .returning()
  return contact!
}

type NewCatalogItem = Omit<
  typeof schema.catalogItems.$inferInsert,
  "organizationId" | "catalogTypeId"
> & { catalogTypeId?: string }

/**
 * The Organization's Catalog Type named `singular` (ignoring case), e.g.
 * the default "Product" or "Add-on".
 */
export async function catalogTypeNamed(
  db: Db,
  organization: { id: string },
  singular: string
) {
  const [type] = await organizationScope(db, organization.id).findMany(
    schema.catalogTypes,
    {
      where: sql`lower(${schema.catalogTypes.singular}) = lower(${singular})`,
      limit: 1,
    }
  )
  if (!type) throw new Error(`No Catalog Type “${singular}”.`)
  return type
}

/** Inserts a Catalog Type after the Organization's others (Each, active). */
export async function createCatalogType(
  db: Db,
  organization: { id: string },
  overrides: Partial<
    Omit<typeof schema.catalogTypes.$inferInsert, "organizationId">
  > = {}
) {
  const singular = overrides.singular ?? `Type ${uuidv7().slice(-8)}`
  const [type] = await db
    .insert(schema.catalogTypes)
    .values({
      singular,
      plural: `${singular}s`,
      billingUnits: ["each"],
      colourIndex: 2,
      sequence: 10,
      ...overrides,
      organizationId: organization.id,
    })
    .returning()
  return type!
}

/**
 * Inserts a Catalog Item at 100 / 60 unless overridden, of the Catalog Type
 * `type` names (default: "Product") unless `catalogTypeId` is given.
 */
export async function createCatalogItem(
  db: Db,
  organization: { id: string },
  {
    type = "Product",
    ...overrides
  }: Partial<NewCatalogItem> & {
    type?: string
  } = {}
) {
  const catalogTypeId =
    overrides.catalogTypeId ??
    (await catalogTypeNamed(db, organization, type)).id
  const [item] = await db
    .insert(schema.catalogItems)
    .values({
      name: `Item ${uuidv7().slice(-12)}`,
      price: "100",
      cost: "60",
      ...overrides,
      catalogTypeId,
      organizationId: organization.id,
    })
    .returning()
  return item!
}

type NewResourceRole = Omit<
  typeof schema.resourceRoles.$inferInsert,
  "organizationId"
>

/** Inserts a Resource Role (150 / 100 an hour unless overridden). */
export async function createResourceRole(
  db: Db,
  organization: { id: string },
  overrides: Partial<NewResourceRole> = {}
) {
  const [role] = await db
    .insert(schema.resourceRoles)
    .values({
      name: `Role ${uuidv7().slice(-12)}`,
      billRate: "150",
      costRate: "100",
      ...overrides,
      organizationId: organization.id,
    })
    .returning()
  return role!
}

type NewQuote = Omit<
  typeof schema.quotes.$inferInsert,
  | "organizationId"
  | "ownerId"
  | "createdById"
  | "updatedById"
  | "customerId"
  | "statusId"
> & { statusId?: string }

/**
 * Inserts a Quote owned (and created) by `owner`, for `customer` (a new
 * Customer when omitted): Draft, Oct–Dec 2026, Months, USD, unless
 * overridden. It sits on its Stage's first Quote Status unless `statusId`
 * is given. No Approval Steps are written (see `createApprovalStep`).
 *
 *   const quote = await createQuote(db, acme, { owner: member.user, stage: "approved" })
 */
export async function createQuote(
  db: Db,
  organization: { id: string },
  {
    owner,
    customer,
    ...overrides
  }: { owner: { id: string }; customer?: { id: string } } & Partial<NewQuote>
) {
  const customerId = customer?.id ?? (await createCustomer(db, organization)).id
  const stage = overrides.stage ?? "draft"
  const statusId =
    overrides.statusId ??
    (await stageEntryStatus(organizationScope(db, organization.id), stage)).id
  const [quote] = await db
    .insert(schema.quotes)
    .values({
      name: `Quote ${uuidv7().slice(-12)}`,
      startDate: "2026-10-01",
      endDate: "2026-12-31",
      timePeriod: "months",
      currencyCode: "USD",
      ...overrides,
      stage,
      statusId,
      organizationId: organization.id,
      customerId,
      ownerId: owner.id,
      createdById: owner.id,
      updatedById: owner.id,
    })
    .returning()
  return quote!
}

/**
 * Appends an Approval Step for `action` to `quote`'s history, as if taken
 * from the one Stage that allows it (e.g. `reject`: In Approval → Draft),
 * with the default Status names. A `status_change` stays in `stage`
 * (default Draft). Only the history changes, not the Quote: insert the Quote
 * in the step's target Stage. `createdAt` defaults to now.
 *
 *   const quote = await createQuote(db, acme, { owner })  // Draft
 *   await createApprovalStep(db, quote, { action: "reject", actor: approver })  // Rejected
 */
export async function createApprovalStep(
  db: Db,
  quote: { id: string; organizationId: string },
  {
    action,
    actor,
    comment = null,
    createdAt,
    stage = "draft",
  }: {
    action: ApprovalStepAction
    actor: { id: string }
    comment?: string | null
    createdAt?: Date
    /** The Stage a `status_change` happens in. */
    stage?: QuoteStage
  }
) {
  const fromStage =
    action === "status_change"
      ? stage
      : QUOTE_STAGES.find((from) => nextStage(from, action))!
  const toStage =
    action === "status_change" ? stage : nextStage(fromStage, action)!
  const scope = organizationScope(db, quote.organizationId)
  const [from, to] = await Promise.all([
    stageEntryStatus(scope, fromStage),
    stageEntryStatus(scope, toStage),
  ])
  const [step] = await db
    .insert(schema.approvalSteps)
    .values({
      organizationId: quote.organizationId,
      quoteId: quote.id,
      action,
      fromStage,
      toStage,
      fromStatusName: from.name,
      toStatusName: to.name,
      actorId: actor.id,
      comment,
      ...(createdAt ? { createdAt } : {}),
    })
    .returning()
  return step!
}

/**
 * Adds a Quote Status to `organization`'s `stage`, after the Stage's
 * existing ones unless `sequence` is given. Returns the row.
 *
 *   const legal = await createQuoteStatus(db, acme, { stage: "in_approval", name: "Legal review" })
 */
export async function createQuoteStatus(
  db: Db,
  organization: { id: string },
  {
    stage,
    name,
    sequence = 100,
    colour = null,
  }: {
    stage: QuoteStage
    name: string
    sequence?: number
    colour?: string | null
  }
) {
  return organizationScope(db, organization.id).insert(schema.quoteStatuses, {
    stage,
    name,
    sequence,
    colour,
  })
}

/**
 * Moves `quote` straight into `stage` (onto its first Quote Status),
 * without an Approval Step: for tests that need a Quote in some Stage
 * after building it as a Draft.
 */
export async function setQuoteStage(
  db: Db,
  quote: { id: string; organizationId: string },
  stage: QuoteStage
) {
  const status = await stageEntryStatus(
    organizationScope(db, quote.organizationId),
    stage
  )
  await db
    .update(schema.quotes)
    .set({ stage, statusId: status.id })
    .where(eq(schema.quotes.id, quote.id))
}
