import { and, eq } from "drizzle-orm"

import type { Db } from "../index"
import { catalogItems, resourceRoles } from "../schema"
import type { NewCatalogItem, NewResourceRole, Organization } from "../schema"

type SeedItem = Omit<NewCatalogItem, "organizationId" | "id">
type SeedRole = Omit<NewResourceRole, "organizationId" | "id">

const product = (
  name: string,
  description: string,
  price: string,
  cost: string,
  tags: string[]
): SeedItem => ({
  kind: "product",
  name,
  description,
  price,
  cost,
  billingUnit: "each",
  tags,
})

const addOn = (
  name: string,
  description: string,
  price: string,
  cost: string,
  billingUnit: "each" | "hour",
  tags: string[]
): SeedItem => ({
  kind: "add_on",
  name,
  description,
  price,
  cost,
  billingUnit,
  tags,
})

/**
 * Demo Products and Add-ons for `acme`: the portal's sample price list
 * (`salesforce/data/product.csv` and `add-on.csv` in the old repository),
 * without the "AI Engineering Consultation" row.
 */
export const SEED_CATALOG_ITEMS: SeedItem[] = [
  product(
    "Senior Developer Service",
    "Experienced software developer",
    "150.00",
    "120.00",
    ["development", "senior"]
  ),
  product(
    "Basic Support Package",
    "Basic customer support service",
    "75.00",
    "50.00",
    ["support", "basic"]
  ),
  product(
    "DevOps Consulting Service",
    "Senior DevOps and Cloud Infrastructure architect",
    "165.00",
    "130.00",
    ["devops", "cloud", "senior"]
  ),
  product(
    "UI/UX Design Package",
    "User Experience and Interface Design sprint",
    "115.00",
    "90.00",
    ["design", "ux", "ui"]
  ),
  product(
    "Premium Support Plan",
    "24/7 dedicated support and SLA management",
    "250.00",
    "180.00",
    ["support", "premium", "dedicated"]
  ),
  product(
    "Solutions Architecture Workshop",
    "Cloud architecture mapping and solutions design",
    "185.00",
    "150.00",
    ["architecture", "solutions", "workshop"]
  ),
  product(
    "API Documentation Audit",
    "Technical review and mapping of API documentation",
    "85.00",
    "65.00",
    ["writing", "api", "documentation"]
  ),
  product(
    "Database Migration Service",
    "Comprehensive database architecture and migration",
    "140.00",
    "110.00",
    ["database", "migration", "db"]
  ),
  product(
    "Cybersecurity Audit Package",
    "Threat modeling and systems security review",
    "190.00",
    "155.00",
    ["security", "audit", "compliance"]
  ),
  product(
    "Agile Product Management Sprint",
    "Professional Product Owner and backlog grooming",
    "135.00",
    "105.00",
    ["product", "agile", "sprint"]
  ),
  addOn(
    "Project Management",
    "Project management services",
    "125.00",
    "100.00",
    "hour",
    ["management", "project"]
  ),
  addOn(
    "Code Review",
    "Additional code review service",
    "50.00",
    "30.00",
    "each",
    ["review", "quality"]
  ),
  addOn(
    "Quality Assurance Testing",
    "Extra software testing and automation coverage",
    "95.00",
    "75.00",
    "hour",
    ["testing", "automation"]
  ),
  addOn(
    "DevOps Architecture Advisory",
    "Senior advice on cloud infrastructure scaling",
    "165.00",
    "130.00",
    "hour",
    ["devops", "cloud", "advisor"]
  ),
  addOn(
    "UI Design Integration",
    "Extra front-end mockups and styling refinement",
    "115.00",
    "90.00",
    "hour",
    ["design", "ui", "style"]
  ),
  addOn(
    "Database Optimization Audit",
    "Query tuning and database performance analytics",
    "140.00",
    "110.00",
    "hour",
    ["database", "performance", "audit"]
  ),
  addOn(
    "Cybersecurity Vulnerability Scan",
    "External penetration scanning and system validation",
    "190.00",
    "155.00",
    "each",
    ["security", "vulnerability", "scan"]
  ),
  addOn(
    "Technical Documentation Authoring",
    "User manuals and architectural blueprints creation",
    "85.00",
    "65.00",
    "hour",
    ["documentation", "authoring", "writing"]
  ),
  addOn(
    "Data Analytics Dashboard Prep",
    "Preparation of customized PowerBI/Looker reports",
    "105.00",
    "80.00",
    "each",
    ["analytics", "dashboard", "reports"]
  ),
]

const role = (
  name: string,
  description: string,
  billRate: string,
  costRate: string,
  locationCountry: string,
  locationState: string,
  locationCity: string
): SeedRole => ({
  name,
  description,
  billRate,
  costRate,
  locationCountry,
  locationState,
  locationCity,
})

/**
 * Demo Resource Roles for `acme`: the portal's sample list
 * (`salesforce/data/resource_roles.csv`), priced to match the catalog above.
 */
export const SEED_RESOURCE_ROLES: SeedRole[] = [
  role(
    "Software Engineer",
    "Senior software engineer",
    "150.00",
    "120.00",
    "United States",
    "California",
    "San Francisco"
  ),
  role(
    "Project Manager",
    "Experienced project manager",
    "125.00",
    "100.00",
    "United States",
    "New York",
    "New York"
  ),
  role(
    "Junior Developer",
    "Entry level developer",
    "75.00",
    "60.00",
    "Canada",
    "Ontario",
    "Toronto"
  ),
  role(
    "DevOps Engineer",
    "Senior DevOps and Cloud Infrastructure architect",
    "165.00",
    "130.00",
    "United States",
    "Washington",
    "Seattle"
  ),
  role(
    "QA Engineer",
    "Quality Assurance automation engineer",
    "95.00",
    "75.00",
    "United States",
    "Texas",
    "Austin"
  ),
  role(
    "UX Designer",
    "User Experience and Interface Designer",
    "115.00",
    "90.00",
    "United States",
    "California",
    "Los Angeles"
  ),
  role(
    "Solutions Architect",
    "Cloud solutions design and advisory",
    "185.00",
    "150.00",
    "United States",
    "Illinois",
    "Chicago"
  ),
  role(
    "Technical Writer",
    "API documentation specialist",
    "85.00",
    "65.00",
    "Canada",
    "British Columbia",
    "Vancouver"
  ),
  role(
    "Data Analyst",
    "Business intelligence and data visualization specialist",
    "105.00",
    "80.00",
    "United States",
    "Georgia",
    "Atlanta"
  ),
  role(
    "Database Administrator",
    "Relational database administration and optimization specialist",
    "140.00",
    "110.00",
    "United States",
    "North Carolina",
    "Raleigh"
  ),
]

/**
 * Idempotent: Catalog Items are matched by (kind, name) and Resource Roles
 * by name within the Organization, then reset to these values (active).
 */
export async function seedCatalog(db: Db, organization: Organization) {
  const organizationId = organization.id
  for (const item of SEED_CATALOG_ITEMS) {
    const values = { ...item, active: true }
    const [existing] = await db
      .select({ id: catalogItems.id })
      .from(catalogItems)
      .where(
        and(
          eq(catalogItems.organizationId, organizationId),
          eq(catalogItems.kind, item.kind),
          eq(catalogItems.name, item.name)
        )
      )
    if (existing) {
      await db
        .update(catalogItems)
        .set(values)
        .where(eq(catalogItems.id, existing.id))
    } else {
      await db.insert(catalogItems).values({ ...values, organizationId })
    }
  }
  for (const seedRole of SEED_RESOURCE_ROLES) {
    const values = { ...seedRole, active: true }
    const [existing] = await db
      .select({ id: resourceRoles.id })
      .from(resourceRoles)
      .where(
        and(
          eq(resourceRoles.organizationId, organizationId),
          eq(resourceRoles.name, seedRole.name)
        )
      )
    if (existing) {
      await db
        .update(resourceRoles)
        .set(values)
        .where(eq(resourceRoles.id, existing.id))
    } else {
      await db.insert(resourceRoles).values({ ...values, organizationId })
    }
  }
}
