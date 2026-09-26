import { randomBytes } from "node:crypto"

import type { SessionUser } from "@workspace/auth"
import type { Role } from "@workspace/domain/enums"
import { createInvitationToken, schema, uuidv7 } from "@workspace/db"
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

/** Inserts an Organization (unique slug by default, USD). Returns the row. */
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
  "organizationId"
>

/** Inserts a Catalog Item (a Product at 100 / 60 unless overridden). */
export async function createCatalogItem(
  db: Db,
  organization: { id: string },
  overrides: Partial<NewCatalogItem> = {}
) {
  const [item] = await db
    .insert(schema.catalogItems)
    .values({
      kind: "product",
      name: `Item ${uuidv7().slice(-12)}`,
      price: "100",
      cost: "60",
      ...overrides,
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
  "organizationId" | "ownerId" | "createdById" | "updatedById" | "customerId"
>

/**
 * Inserts a Quote owned (and created) by `owner`, for `customer` (a new
 * Customer when omitted): Draft, Oct–Dec 2026, Months, USD, unless overridden.
 *
 *   const quote = await createQuote(db, acme, { owner: member.user, status: "approved" })
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
  const [quote] = await db
    .insert(schema.quotes)
    .values({
      name: `Quote ${uuidv7().slice(-12)}`,
      startDate: "2026-10-01",
      endDate: "2026-12-31",
      timePeriod: "months",
      currencyCode: "USD",
      ...overrides,
      organizationId: organization.id,
      customerId,
      ownerId: owner.id,
      createdById: owner.id,
      updatedById: owner.id,
    })
    .returning()
  return quote!
}
