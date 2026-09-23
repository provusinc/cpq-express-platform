import { and, eq } from "drizzle-orm"

import type { DiscountKind, SourceKind } from "@workspace/domain/enums"
import { defaultLineItemQuantity } from "@workspace/domain/pricing"

import type { Db } from "../index"
import { organizationScope } from "../organization-scope"
import { recomputeQuoteTotals } from "../quote-totals"
import {
  catalogItems,
  lineItems,
  organizationSettings,
  quotes,
  resourceRoles,
  users,
} from "../schema"
import type { Organization } from "../schema"
import { SEED_QUOTES } from "./quotes"

interface SeedLine {
  kind: SourceKind
  /** The seeded Catalog Item's or Resource Role's name. */
  source: string
  /** Omitted: the default quantity (one Time Period of hours, or 1). */
  quantity?: string
  /** A negotiated rate overriding the Base Rate price. */
  unitPrice?: string
  notes?: string
}

/**
 * Line Items (and a Quote Discount) for the demo Quotes, by Quote Name, so
 * the editor, the list's totals and the lock have content. Sources come
 * from `seed/catalog.ts`.
 */
export const SEED_LINE_ITEMS: Record<
  string,
  { lines: SeedLine[]; discount?: { kind: DiscountKind; value: string } }
> = {
  "Acme Corp – Platform rollout": {
    lines: [
      { kind: "resource_role", source: "Solutions Architect", quantity: "320" },
      { kind: "resource_role", source: "Software Engineer", quantity: "640" },
      {
        kind: "product",
        source: "Senior Developer Service",
        quantity: "2",
        notes: "Two on-site weeks",
      },
      { kind: "add_on", source: "Code Review", quantity: "4" },
      {
        kind: "add_on",
        source: "Quality Assurance Testing",
        quantity: "160",
        unitPrice: "90.00",
        notes: "Negotiated rate",
      },
    ],
    discount: { kind: "percent", value: "5" },
  },
  "TechStart – Support retainer": {
    lines: [
      { kind: "product", source: "Premium Support Plan", quantity: "12" },
      { kind: "resource_role", source: "Project Manager", quantity: "120" },
    ],
    discount: { kind: "amount", value: "500" },
  },
  "Global Mfg – Line automation": {
    lines: [
      { kind: "resource_role", source: "DevOps Engineer", quantity: "480" },
      { kind: "product", source: "DevOps Consulting Service" },
    ],
  },
  "Healthcare – Records migration": {
    lines: [
      { kind: "product", source: "Database Migration Service" },
      {
        kind: "resource_role",
        source: "Database Administrator",
        quantity: "200",
      },
      { kind: "resource_role", source: "Data Analyst" },
    ],
  },
  "Retail – Store pilot": {
    lines: [
      { kind: "resource_role", source: "UX Designer", quantity: "40" },
      { kind: "product", source: "UI/UX Design Package" },
    ],
  },
  "Acme Corp – Analytics add-on": {
    lines: [
      { kind: "resource_role", source: "Data Analyst", quantity: "160" },
      {
        kind: "add_on",
        source: "Data Analytics Dashboard Prep",
        quantity: "3",
      },
    ],
  },
  "Global Mfg – Predictive maintenance": {
    lines: [
      { kind: "resource_role", source: "DevOps Engineer", quantity: "600" },
      { kind: "resource_role", source: "Data Analyst", quantity: "300" },
    ],
  },
  "Retail – Loyalty app": {
    lines: [
      { kind: "resource_role", source: "UX Designer", quantity: "200" },
      { kind: "resource_role", source: "Software Engineer", quantity: "480" },
      { kind: "add_on", source: "Quality Assurance Testing", quantity: "80" },
    ],
  },
  "Healthcare – Patient portal": {
    lines: [
      { kind: "resource_role", source: "Software Engineer", quantity: "400" },
      { kind: "resource_role", source: "QA Engineer", quantity: "160" },
    ],
    discount: { kind: "percent", value: "8" },
  },
  "TechStart – Cloud migration": {
    lines: [
      { kind: "resource_role", source: "DevOps Engineer", quantity: "320" },
      { kind: "product", source: "DevOps Consulting Service", quantity: "3" },
    ],
  },
  "Acme Corp – Data warehouse": {
    lines: [
      {
        kind: "resource_role",
        source: "Database Administrator",
        quantity: "240",
      },
      { kind: "resource_role", source: "Data Analyst", quantity: "240" },
    ],
  },
  "Global Mfg – Quality dashboards": {
    lines: [
      { kind: "resource_role", source: "Data Analyst", quantity: "120" },
      {
        kind: "add_on",
        source: "Data Analytics Dashboard Prep",
        quantity: "4",
      },
    ],
  },
  "Retail – POS integration": {
    lines: [
      { kind: "resource_role", source: "Software Engineer", quantity: "320" },
      { kind: "product", source: "Senior Developer Service", quantity: "4" },
    ],
  },
  "Acme Corp – Integration sprint": {
    lines: [
      {
        kind: "product",
        source: "Agile Product Management Sprint",
        quantity: "2",
      },
      { kind: "resource_role", source: "Software Engineer", quantity: "160" },
    ],
    discount: { kind: "percent", value: "15" },
  },
  "Healthcare – Compliance audit": {
    lines: [
      { kind: "product", source: "Cybersecurity Audit Package", quantity: "2" },
      {
        kind: "resource_role",
        source: "Software Engineer",
        quantity: "120",
        unitPrice: "128.00",
        notes: "Matched a competitor's rate",
      },
    ],
  },
  "TechStart – Pen test": {
    lines: [
      { kind: "product", source: "Cybersecurity Audit Package" },
      {
        kind: "add_on",
        source: "Cybersecurity Vulnerability Scan",
        quantity: "3",
      },
    ],
  },
  "TechStart – Mobile MVP": {
    lines: [
      {
        kind: "resource_role",
        source: "Software Engineer",
        quantity: "640",
        unitPrice: "132.00",
        notes: "Startup discount",
      },
      { kind: "resource_role", source: "UX Designer", quantity: "120" },
    ],
  },
  "Acme Corp – Support renewal": {
    lines: [
      { kind: "product", source: "Premium Support Plan", quantity: "12" },
      { kind: "product", source: "Basic Support Package", quantity: "12" },
    ],
  },
  "Retail – Analytics add-on": {
    lines: [{ kind: "resource_role", source: "Data Analyst", quantity: "80" }],
  },
  "Global Mfg – Line automation phase 2": {
    lines: [
      { kind: "resource_role", source: "DevOps Engineer", quantity: "400" },
      { kind: "resource_role", source: "Project Manager", quantity: "80" },
    ],
  },
  "Retail – Store pilot rollout": {
    lines: [
      { kind: "resource_role", source: "UX Designer", quantity: "80" },
      { kind: "product", source: "UI/UX Design Package", quantity: "2" },
    ],
  },
  "Healthcare – Records migration phase 2": {
    lines: [
      { kind: "product", source: "Database Migration Service" },
      {
        kind: "resource_role",
        source: "Software Engineer",
        quantity: "160",
        unitPrice: "125.00",
      },
    ],
  },
  "TechStart – Security review": {
    lines: [
      { kind: "product", source: "Cybersecurity Audit Package" },
      {
        kind: "add_on",
        source: "Cybersecurity Vulnerability Scan",
        quantity: "2",
      },
    ],
  },
}

/**
 * Replaces each demo Quote's Line Items with `SEED_LINE_ITEMS` (Base Rates
 * from the current seeded catalog) and prices it with
 * `recomputeQuoteTotals`, the same code the API runs after every command.
 * Idempotent: the seeded Quotes' lines are rebuilt on every run.
 */
export async function seedLineItems(db: Db, organization: Organization) {
  const scope = organizationScope(db, organization.id)
  const [settings] = await scope.findMany(organizationSettings, { limit: 1 })
  const hoursPerDay = settings?.hoursPerDay ?? "8"

  for (const seedQuote of SEED_QUOTES) {
    const plan = SEED_LINE_ITEMS[seedQuote.name]
    if (!plan) continue
    const [owner] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, seedQuote.owner))
    const [quote] = await scope.findMany(quotes, {
      where: and(
        eq(quotes.ownerId, owner!.id),
        eq(quotes.name, seedQuote.name)
      ),
      limit: 1,
    })
    if (!quote) throw new Error(`Seed Line Items: missing “${seedQuote.name}”.`)

    await db
      .delete(lineItems)
      .where(scope.where(lineItems, eq(lineItems.quoteId, quote.id)))
    const values = []
    for (const [sequence, line] of plan.lines.entries()) {
      const source = await findSource(db, organization.id, line)
      values.push({
        quoteId: quote.id,
        sourceKind: line.kind,
        catalogItemId: line.kind === "resource_role" ? null : source.id,
        resourceRoleId: line.kind === "resource_role" ? source.id : null,
        name: source.name,
        description: source.description,
        notes: line.notes ?? null,
        startDate: quote.startDate,
        endDate: quote.endDate,
        billingUnit: source.billingUnit,
        basePrice: source.price,
        baseCost: source.cost,
        unitPrice: line.unitPrice ?? source.price,
        unitCost: source.cost,
        quantity:
          line.quantity ??
          defaultLineItemQuantity({
            billingUnit: source.billingUnit,
            timePeriod: quote.timePeriod,
            hoursPerDay,
          }),
        sequence,
      })
    }
    await scope.insertMany(lineItems, values)
    await scope.update(quotes, quote.id, {
      discountKind: plan.discount?.kind ?? null,
      discountValue: plan.discount?.value ?? null,
    })
    await recomputeQuoteTotals(scope, quote.id, { updatedById: owner!.id })
  }
}

async function findSource(db: Db, organizationId: string, line: SeedLine) {
  if (line.kind === "resource_role") {
    const [role] = await db
      .select()
      .from(resourceRoles)
      .where(
        and(
          eq(resourceRoles.organizationId, organizationId),
          eq(resourceRoles.name, line.source)
        )
      )
    if (!role)
      throw new Error(`Seed Line Items: no Resource Role “${line.source}”.`)
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      billingUnit: "hour" as const,
      price: role.billRate,
      cost: role.costRate,
    }
  }
  const [item] = await db
    .select()
    .from(catalogItems)
    .where(
      and(
        eq(catalogItems.organizationId, organizationId),
        eq(catalogItems.kind, line.kind),
        eq(catalogItems.name, line.source)
      )
    )
  if (!item)
    throw new Error(`Seed Line Items: no ${line.kind} “${line.source}”.`)
  return item
}
