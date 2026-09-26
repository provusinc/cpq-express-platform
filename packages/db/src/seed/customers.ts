import { and, eq, sql } from "drizzle-orm"

import type { Db } from "../index"
import { customers, contacts } from "../schema"
import type { Organization } from "../schema"

/**
 * Demo Customers for `acme`: the five sample Customers of the Salesforce
 * edition's data plan (`salesforce/data/accounts.json`), each with two
 * Contacts (the first is primary). The old data had no Contacts.
 *
 * Idempotent: Customers are matched by name (case-insensitive, trimmed, the
 * unique key) and Contacts by (Customer, email), then reset to these values.
 */
export const SEED_CUSTOMERS = [
  {
    name: "Acme Corp Express CPQ Demo",
    type: "Customer - Direct",
    industry: "Technology",
    phone: "(555) 123-4567",
    website: "https://www.acme-corp.com",
    billingStreet: "123 Main Street",
    billingCity: "San Francisco",
    billingState: "CA",
    billingPostalCode: "94105",
    billingCountry: "USA",
    contacts: [
      {
        name: "Jordan Rivera",
        title: "VP of Engineering",
        email: "jordan.rivera@acme-corp.example",
        phone: "(555) 123-4501",
      },
      {
        name: "Priya Shah",
        title: "Procurement Manager",
        email: "priya.shah@acme-corp.example",
        phone: "(555) 123-4502",
      },
    ],
  },
  {
    name: "TechStart Express CPQ Demo",
    type: "Prospect",
    industry: "Software",
    phone: "(555) 987-6543",
    website: "https://www.techstart.com",
    billingStreet: "456 Innovation Drive",
    billingCity: "Austin",
    billingState: "TX",
    billingPostalCode: "78701",
    billingCountry: "USA",
    contacts: [
      {
        name: "Sam Okafor",
        title: "CTO",
        email: "sam.okafor@techstart.example",
        phone: "(555) 987-6501",
      },
      {
        name: "Lena Fischer",
        title: "Head of Product",
        email: "lena.fischer@techstart.example",
        phone: null,
      },
    ],
  },
  {
    name: "Global Mfg Express",
    type: "Customer - Direct",
    industry: "Manufacturing",
    phone: "(555) 456-7890",
    website: "https://www.globalmfg.com",
    billingStreet: "789 Industrial Blvd",
    billingCity: "Detroit",
    billingState: "MI",
    billingPostalCode: "48201",
    billingCountry: "USA",
    contacts: [
      {
        name: "Maria Gonzalez",
        title: "Director of IT",
        email: "maria.gonzalez@globalmfg.example",
        phone: "(555) 456-7801",
      },
      {
        name: "Tom Becker",
        title: "Plant Operations Lead",
        email: "tom.becker@globalmfg.example",
        phone: "(555) 456-7802",
      },
    ],
  },
  {
    name: "Healthcare Express",
    type: "Customer - Partner",
    industry: "Healthcare",
    phone: "(555) 321-9876",
    website: "https://www.healthpartners.com",
    billingStreet: "321 Medical Center Dr",
    billingCity: "Chicago",
    billingState: "IL",
    billingPostalCode: "60601",
    billingCountry: "USA",
    contacts: [
      {
        name: "Dr. Aisha Khan",
        title: "Chief Medical Information Officer",
        email: "aisha.khan@healthpartners.example",
        phone: "(555) 321-9801",
      },
      {
        name: "Chris Nguyen",
        title: "IT Program Manager",
        email: "chris.nguyen@healthpartners.example",
        phone: null,
      },
    ],
  },
  {
    name: "Retail Express",
    type: "Prospect",
    industry: "Retail",
    phone: "(555) 654-3210",
    website: "https://www.retailsolutions.com",
    billingStreet: "654 Commerce Way",
    billingCity: "Seattle",
    billingState: "WA",
    billingPostalCode: "98101",
    billingCountry: "USA",
    contacts: [
      {
        name: "Emily Carter",
        title: "Director of E-commerce",
        email: "emily.carter@retailsolutions.example",
        phone: "(555) 654-3201",
      },
      {
        name: "Diego Martins",
        title: "Store Systems Manager",
        email: "diego.martins@retailsolutions.example",
        phone: "(555) 654-3202",
      },
    ],
  },
] as const

export async function seedCustomers(db: Db, organization: Organization) {
  const organizationId = organization.id
  for (const { contacts: seedContacts, ...values } of SEED_CUSTOMERS) {
    const [existing] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.organizationId, organizationId),
          sql`lower(btrim(${customers.name})) = lower(btrim(${values.name}))`
        )
      )
    const [customer] = existing
      ? await db
          .update(customers)
          .set({ ...values, archived: false })
          .where(eq(customers.id, existing.id))
          .returning()
      : await db
          .insert(customers)
          .values({ ...values, organizationId })
          .returning()

    // Reset the primary flag first so the one-primary index never trips.
    await db
      .update(contacts)
      .set({ isPrimary: false })
      .where(
        and(
          eq(contacts.organizationId, organizationId),
          eq(contacts.customerId, customer!.id)
        )
      )
    for (const [index, contact] of seedContacts.entries()) {
      const row = { ...contact, isPrimary: index === 0 }
      const [found] = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.organizationId, organizationId),
            eq(contacts.customerId, customer!.id),
            eq(contacts.email, contact.email)
          )
        )
      if (found) {
        await db.update(contacts).set(row).where(eq(contacts.id, found.id))
      } else {
        await db
          .insert(contacts)
          .values({ ...row, organizationId, customerId: customer!.id })
      }
    }
  }
  return SEED_CUSTOMERS.length
}
