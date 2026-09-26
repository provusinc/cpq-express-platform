/**
 * Quote Documents on the server (glossary: Quote Document): building the
 * render snapshot, generating a new immutable version, and reading or
 * removing the stored files.
 *
 * - `buildQuoteDocumentSnapshot(scope, quote)` → the plain
 *   `QuoteDocumentSnapshot` (`@workspace/documents`): Quote header and
 *   totals, Bill To (the Customer and its primary Contact), profile
 *   information, Phases, Line Items in grid order, Milestones and labels.
 *   It never includes costs or margins.
 * - `quoteDocumentLogo(storage, logoKey)` → the logo as a `data:` URL (PNG
 *   or JPEG only; the PDF renderer can't embed SVG or WebP) or `null`.
 * - `generateQuoteDocument(scope, quoteId, { actor, storage, notes?,
 *   capturedByMarkSent? })` locks the Quote row (`FOR UPDATE`, so versions
 *   are assigned one at a time: max + 1), snapshots it, renders the PDF on
 *   the server, stores it under `organizations/<id>/quote-documents/`, and
 *   records the row. Call it inside the command's transaction — Mark as Sent
 *   (#22) passes `capturedByMarkSent: true` from its own `quoteCommand`, so
 *   the transition and the captured Document commit (or fail) together. It
 *   checks no permission: callers do (any member may generate).
 * - `removeQuoteDocumentObjects(storage, keys)` deletes stored files after
 *   their rows are gone (Quote Document delete; Quote delete, #23).
 */
import { TRPCError } from "@trpc/server"

import {
  and,
  asc,
  eq,
  findQuoteStatus,
  max,
  schema,
  uuidv7,
} from "@workspace/db"
import type { OrganizationScope } from "@workspace/db"
import type { DocumentSettings } from "@workspace/domain/documents"
import type { Actor } from "@workspace/domain/policy"
import type { QuoteDocumentSnapshot } from "@workspace/documents"
import { renderQuoteDocument } from "@workspace/documents/server"
import { organizationObjectKey } from "@workspace/storage"
import type { ObjectStorage } from "@workspace/storage"

import { notFound } from "./errors"
import type { QuoteRow } from "./quotes"
import { getDocumentSettings, getLabels } from "./settings"

const {
  customers,
  contacts,
  lineItems,
  milestones,
  organizations,
  phases,
  quoteDocuments,
  quotes,
  users,
} = schema

/** Object-key area of Quote Documents: `organizations/<id>/quote-documents/<id>.pdf`. */
export const QUOTE_DOCUMENT_AREA = "quote-documents"

export const QUOTE_DOCUMENT_NOTES_MAX = 1000

/** Logo types the PDF renderer can embed. */
const EMBEDDABLE_LOGO_TYPES = new Set(["image/png", "image/jpeg"])

/** The Quote's Milestones for the document, by date then name. */
function loadMilestones(
  scope: OrganizationScope,
  quoteId: string
): Promise<QuoteDocumentSnapshot["milestones"]> {
  return scope.db
    .select({
      name: milestones.name,
      date: milestones.date,
      type: milestones.type,
      description: milestones.description,
      completed: milestones.completed,
    })
    .from(milestones)
    .where(
      and(
        eq(milestones.organizationId, scope.organizationId),
        eq(milestones.quoteId, quoteId)
      )
    )
    .orderBy(asc(milestones.date), asc(milestones.name), asc(milestones.id))
}

/** The render snapshot of `quote` as it stands now (see the module comment). */
export async function buildQuoteDocumentSnapshot(
  scope: OrganizationScope,
  quote: QuoteRow,
  {
    version = null,
    generatedAt = new Date(),
  }: { version?: number | null; generatedAt?: Date } = {}
): Promise<QuoteDocumentSnapshot> {
  const [
    [customer],
    [contact],
    [profile],
    [owner],
    phaseRows,
    lineRows,
    milestones,
    labels,
    status,
  ] = await Promise.all([
    scope.findMany(customers, {
      where: eq(customers.id, quote.customerId),
      limit: 1,
    }),
    scope.findMany(contacts, {
      where: and(
        eq(contacts.customerId, quote.customerId),
        eq(contacts.isPrimary, true)
      ),
      limit: 1,
    }),
    scope.db
      .select({
        name: organizations.name,
        email: organizations.email,
        phone: organizations.phone,
        website: organizations.website,
        addressLine1: organizations.addressLine1,
        addressLine2: organizations.addressLine2,
        city: organizations.city,
        region: organizations.region,
        postalCode: organizations.postalCode,
        country: organizations.country,
        logoKey: organizations.logoKey,
      })
      .from(organizations)
      .where(eq(organizations.id, scope.organizationId))
      .limit(1),
    scope.db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, quote.ownerId))
      .limit(1),
    scope.findMany(phases, {
      where: eq(phases.quoteId, quote.id),
      orderBy: [asc(phases.sequence), asc(phases.id)],
    }),
    scope.findMany(lineItems, {
      where: eq(lineItems.quoteId, quote.id),
      orderBy: [asc(lineItems.sequence), asc(lineItems.id)],
    }),
    loadMilestones(scope, quote.id),
    getLabels(scope),
    findQuoteStatus(scope, quote.statusId),
  ])
  return {
    schemaVersion: 1,
    generatedAt: generatedAt.toISOString(),
    version,
    quote: {
      id: quote.id,
      name: quote.name,
      description: quote.description,
      stage: quote.stage,
      status: status?.name ?? "",
      startDate: quote.startDate,
      endDate: quote.endDate,
      validUntil: quote.validUntil,
      timePeriod: quote.timePeriod,
      currencyCode: quote.currencyCode,
      discountKind: quote.discountKind,
      discountValue: quote.discountValue,
      subtotal: quote.subtotal,
      discountAmount: quote.discountAmount,
      total: quote.total,
      owner: { name: owner?.name ?? null, email: owner?.email ?? "" },
    },
    customer: {
      name: customer!.name,
      phone: customer!.phone,
      website: customer!.website,
      billingStreet: customer!.billingStreet,
      billingCity: customer!.billingCity,
      billingState: customer!.billingState,
      billingPostalCode: customer!.billingPostalCode,
      billingCountry: customer!.billingCountry,
    },
    contact: contact
      ? {
          name: contact.name,
          title: contact.title,
          email: contact.email,
          phone: contact.phone,
        }
      : null,
    profile: profile!,
    phases: phaseRows.map((p) => ({
      id: p.id,
      parentId: p.parentId,
      name: p.name,
      sequence: p.sequence,
    })),
    lines: lineRows.map((l) => ({
      id: l.id,
      phaseId: l.phaseId,
      sourceKind: l.sourceKind,
      name: l.name,
      description: l.description,
      startDate: l.startDate,
      endDate: l.endDate,
      billingUnit: l.billingUnit,
      unitPrice: l.unitPrice,
      quantity: l.quantity,
      lineTotal: l.lineTotal,
    })),
    milestones,
    labels: {
      phase: { singular: labels.phase.singular, plural: labels.phase.plural },
    },
  }
}

/** The logo as a `data:` URL the PDF can embed, or `null` (none, or SVG/WebP). */
export async function quoteDocumentLogo(
  storage: ObjectStorage,
  logoKey: string | null
): Promise<string | null> {
  if (!logoKey) return null
  try {
    const object = await storage.get(logoKey)
    const type = object?.contentType?.split(";")[0]?.trim().toLowerCase()
    if (!object || !type || !EMBEDDABLE_LOGO_TYPES.has(type)) return null
    return `data:${type};base64,${Buffer.from(object.body).toString("base64")}`
  } catch (error) {
    // A missing logo must not stop a Quote Document.
    console.warn(`Could not read the logo ${logoKey}`, error)
    return null
  }
}

/** What the live preview renders: the snapshot now, the settings and the logo. */
export async function quoteDocumentPreview(
  scope: OrganizationScope,
  storage: ObjectStorage,
  quote: QuoteRow
) {
  const [snapshot, settings] = await Promise.all([
    buildQuoteDocumentSnapshot(scope, quote),
    getDocumentSettings(scope),
  ])
  return {
    snapshot,
    settings,
    logo: await quoteDocumentLogo(storage, snapshot.profile.logoKey),
  }
}

type QuoteDocumentRow = typeof quoteDocuments.$inferSelect

/** A Quote Document as the Documents tab lists it. */
export interface QuoteDocumentView {
  id: string
  quoteId: string
  version: number
  fileName: string
  /** Bytes. */
  fileSize: number
  notes: string | null
  capturedByMarkSent: boolean
  generatedAt: Date
  generatedBy: { id: string; name: string | null; email: string }
  /** Same-origin download route (add `?inline=1` to open in the browser). */
  downloadUrl: string
}

/** "Initech – Oct 2026 v3.pdf": the Quote's Name as it was, and the version. */
export function quoteDocumentFileName(quoteName: string, version: number) {
  const name = quoteName.replace(/[\\/:*?"<>|\p{Cc}]+/gu, " ").trim() || "Quote"
  return `${name} v${version}.pdf`
}

export function quoteDocumentView(
  row: QuoteDocumentRow,
  generatedBy: QuoteDocumentView["generatedBy"]
): QuoteDocumentView {
  const snapshot = row.quoteSnapshot as QuoteDocumentSnapshot
  return {
    id: row.id,
    quoteId: row.quoteId,
    version: row.version,
    fileName: quoteDocumentFileName(snapshot.quote.name, row.version),
    fileSize: row.fileSize,
    notes: row.notes,
    capturedByMarkSent: row.capturedByMarkSent,
    generatedAt: row.generatedAt,
    generatedBy,
    downloadUrl: `/api/documents/${row.id}`,
  }
}

export interface GenerateQuoteDocumentOptions {
  /** Who generates it (recorded as `generated_by`). */
  actor: Pick<Actor, "userId">
  /** Where the PDF is stored (`ctx.storage`). */
  storage: ObjectStorage
  notes?: string | null
  /** Mark as Sent's capture: such a Document can never be deleted. */
  capturedByMarkSent?: boolean
}

/**
 * Generates the next Quote Document version of `quoteId` (see the module
 * comment). NOT_FOUND when the Quote isn't this Organization's. Returns the
 * new Document's view plus the snapshots it was rendered from.
 */
export async function generateQuoteDocument(
  scope: OrganizationScope,
  quoteId: string,
  {
    actor,
    storage,
    notes = null,
    capturedByMarkSent = false,
  }: GenerateQuoteDocumentOptions
): Promise<
  QuoteDocumentView & {
    quoteSnapshot: QuoteDocumentSnapshot
    settingsSnapshot: DocumentSettings
    /** Where the PDF was stored (server only; never return it to clients). */
    storageKey: string
  }
> {
  return scope.transaction(async (tx) => {
    // The Quote's row lock serialises version assignment (and Quote commands).
    const [quote] = await tx.db
      .select()
      .from(quotes)
      .where(tx.where(quotes, eq(quotes.id, quoteId)))
      .limit(1)
      .for("update")
    if (!quote) throw notFound("Quote")

    const [{ latest } = { latest: null }] = await tx.db
      .select({ latest: max(quoteDocuments.version) })
      .from(quoteDocuments)
      .where(tx.where(quoteDocuments, eq(quoteDocuments.quoteId, quote.id)))
    const version = (latest ?? 0) + 1
    const generatedAt = new Date()

    const [snapshot, settings] = await Promise.all([
      buildQuoteDocumentSnapshot(tx, quote, { version, generatedAt }),
      getDocumentSettings(tx),
    ])
    const logo = await quoteDocumentLogo(storage, snapshot.profile.logoKey)
    const pdf = await renderQuoteDocument({ snapshot, settings, logo })

    const id = uuidv7()
    const storageKey = organizationObjectKey(
      tx.organizationId,
      QUOTE_DOCUMENT_AREA,
      `${id}.pdf`
    )
    await storage.put(storageKey, new Uint8Array(pdf), {
      contentType: "application/pdf",
    })
    let stored: QuoteDocumentRow
    try {
      const [row] = await tx.db
        .insert(quoteDocuments)
        .values({
          id,
          organizationId: tx.organizationId,
          quoteId: quote.id,
          version,
          storageKey,
          fileSize: pdf.byteLength,
          quoteSnapshot: snapshot,
          settingsSnapshot: settings,
          notes,
          capturedByMarkSent,
          generatedById: actor.userId,
          generatedAt,
        })
        .returning()
      stored = row!
    } catch (error) {
      // No row, so no one will ever read the file.
      await removeQuoteDocumentObjects(storage, [storageKey])
      throw error
    }
    const [generatedBy] = await tx.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, actor.userId))
      .limit(1)
    return {
      ...quoteDocumentView(stored, generatedBy!),
      quoteSnapshot: snapshot,
      settingsSnapshot: settings,
      storageKey,
    }
  })
}

/**
 * Deletes stored Quote Document files whose rows are gone. A failure only
 * leaves an orphaned object, never a row without its file.
 */
export async function removeQuoteDocumentObjects(
  storage: ObjectStorage,
  keys: readonly string[]
) {
  for (const key of keys) {
    try {
      await storage.delete(key)
    } catch (error) {
      console.warn(`Could not delete ${key} from object storage`, error)
    }
  }
}

/** The PDF refusal the download route turns into an HTTP status. */
export function missingFile(): TRPCError {
  return new TRPCError({
    code: "NOT_FOUND",
    message: "The Quote Document's file is missing.",
  })
}
