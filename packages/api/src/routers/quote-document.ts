/**
 * Quote Documents (glossary: Quote Document): the live preview's input, the
 * Documents tab's list, generating a new version and deleting one. Files are
 * downloaded through the `/api/documents/[id]` route handler, which calls
 * `openQuoteDocument` (below) with the request's headers.
 *
 * Permissions: every member who can see the Quote (every member of its
 * Organization) may preview, list, generate and download. Deleting is for
 * the Quote Owner or an Admin, never for a Document captured by Mark as
 * Sent (`canDeleteQuoteDocument`).
 */
import { TRPCError } from "@trpc/server"
import { z } from "zod"

import { desc, eq, inArray, schema } from "@workspace/db"
import type { Db } from "@workspace/db"
import { canDeleteQuoteDocument } from "@workspace/domain/documents"

import {
  generateQuoteDocument,
  missingFile,
  QUOTE_DOCUMENT_NOTES_MAX,
  quoteDocumentPreview,
  quoteDocumentView,
  removeQuoteDocumentObjects,
} from "../documents"
import type { QuoteDocumentView } from "../documents"
import { notFound } from "../errors"
import { optionalText } from "../inputs"
import type { CreateContextOptions } from "../trpc"
import {
  createCallerFactory,
  createTRPCContext,
  createTRPCRouter,
  organizationProcedure,
} from "../trpc"

const { quoteDocuments, quotes, users } = schema

/** Who generated each row, for the list. */
async function usersOf(
  db: Db,
  ids: string[]
): Promise<Map<string, QuoteDocumentView["generatedBy"]>> {
  if (ids.length === 0) return new Map()
  const people = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, ids))
  return new Map(people.map((p) => [p.id, p]))
}

export const quoteDocumentRouter = createTRPCRouter({
  /**
   * The live preview's render input: the Quote's snapshot as it stands now
   * (`version: null`), the document settings and the logo (a `data:` URL).
   * Feed it to `QuoteDocument` from `@workspace/documents`.
   */
  previewSnapshot: organizationProcedure
    .input(z.object({ quoteId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const quote = await ctx.scope.findById(quotes, input.quoteId)
      if (!quote) throw notFound("Quote")
      return quoteDocumentPreview(ctx.scope, ctx.storage, quote)
    }),

  /**
   * The Quote's Documents, newest first, each with `canDelete` for the
   * caller (Owner or Admin, and not captured by Mark as Sent).
   */
  list: organizationProcedure
    .input(z.object({ quoteId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const quote = await ctx.scope.findById(quotes, input.quoteId)
      if (!quote) throw notFound("Quote")
      const rows = await ctx.scope.findMany(quoteDocuments, {
        where: eq(quoteDocuments.quoteId, quote.id),
        orderBy: [desc(quoteDocuments.version)],
      })
      const people = await usersOf(ctx.scope.db, [
        ...new Set(rows.map((r) => r.generatedById)),
      ])
      return rows.map((row) => ({
        ...quoteDocumentView(row, people.get(row.generatedById)!),
        canDelete: canDeleteQuoteDocument(ctx.actor, quote, row).allowed,
      }))
    }),

  /**
   * Renders the Quote on the server as its next Quote Document version (1,
   * 2, 3… per Quote), stores the PDF and records the snapshots. Any member.
   */
  generate: organizationProcedure
    .input(
      z.object({
        quoteId: z.uuid(),
        notes: optionalText(QUOTE_DOCUMENT_NOTES_MAX),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.scope.transaction(async (scope) => {
        const { quoteSnapshot, settingsSnapshot, ...document } =
          await generateQuoteDocument(scope, input.quoteId, {
            actor: ctx.actor,
            storage: ctx.storage,
            notes: input.notes ?? null,
          })
        void quoteSnapshot
        void settingsSnapshot
        const quote = await scope.findById(quotes, input.quoteId)
        return {
          ...document,
          // The generator needn't be the Owner or an Admin.
          canDelete: canDeleteQuoteDocument(ctx.actor, quote!, document)
            .allowed,
        }
      })
    }),

  /**
   * Deletes a Quote Document and its file. Owner or Admin (FORBIDDEN);
   * one captured by Mark as Sent can never be deleted (PRECONDITION_FAILED).
   */
  delete: organizationProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const storageKey = await ctx.scope.transaction(async (scope) => {
        const [document] = await scope.db
          .select()
          .from(quoteDocuments)
          .where(scope.where(quoteDocuments, eq(quoteDocuments.id, input.id)))
          .limit(1)
          .for("update")
        if (!document) throw notFound("Quote Document")
        const quote = await scope.findById(quotes, document.quoteId)
        const decision = canDeleteQuoteDocument(ctx.actor, quote!, document)
        if (!decision.allowed) {
          throw new TRPCError({
            code:
              decision.reason === "document_captured"
                ? "PRECONDITION_FAILED"
                : "FORBIDDEN",
            message: decision.message,
          })
        }
        await scope.delete(quoteDocuments, document.id)
        return document.storageKey
      })
      await removeQuoteDocumentObjects(ctx.storage, [storageKey])
      return { id: input.id }
    }),
})

/**
 * Server-only procedures, not part of the HTTP API: the download route calls
 * them through `openQuoteDocument`, so it gets the organization tier's
 * checks (session, Membership in the Host's Organization) and returns bytes
 * without a JSON round trip.
 */
const downloadRouter = createTRPCRouter({
  open: organizationProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const document = await ctx.scope.findById(quoteDocuments, input.id)
      if (!document) throw notFound("Quote Document")
      const object = await ctx.storage.get(document.storageKey)
      if (!object) throw missingFile()
      const people = await usersOf(ctx.scope.db, [document.generatedById])
      const view = quoteDocumentView(
        document,
        people.get(document.generatedById)!
      )
      return { fileName: view.fileName, body: object.body, size: object.size }
    }),
})

const createDownloadCaller = createCallerFactory(downloadRouter)

const HTTP_STATUS: Partial<Record<TRPCError["code"], number>> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
}

export type OpenQuoteDocumentResult =
  | { ok: true; fileName: string; body: Uint8Array; size: number }
  | { ok: false; status: number; message: string }

/**
 * The download route's authorization and read, as a plain function: the
 * caller's session (cookie) and Membership in the Organization of the
 * request's `x-organization-slug` (set by the proxy from the Host), then the
 * Document through that Organization's scope. Refusals are uniform: no
 * session 401, no Organization slug 400, no Membership / unknown or another
 * Organization's Document 404.
 */
export async function openQuoteDocument(
  opts: CreateContextOptions,
  id: string
): Promise<OpenQuoteDocumentResult> {
  if (!z.uuid().safeParse(id).success) {
    return { ok: false, status: 404, message: "Quote Document not found." }
  }
  try {
    const caller = createDownloadCaller(await createTRPCContext(opts))
    return { ok: true, ...(await caller.open({ id })) }
  } catch (error) {
    if (error instanceof TRPCError) {
      return {
        ok: false,
        status: HTTP_STATUS[error.code] ?? 500,
        message: error.message,
      }
    }
    throw error
  }
}
