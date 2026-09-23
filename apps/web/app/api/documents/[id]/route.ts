import type { NextRequest } from "next/server"

import { openQuoteDocument } from "@workspace/api"
import { db } from "@workspace/db/client"

/**
 * Quote Document download. The proxy stamps the Host's Organization slug on
 * `/api/*` requests; `openQuoteDocument` checks the session cookie and the
 * caller's Membership in that Organization, then reads the Document through
 * its scope (another Organization's id is a 404). `?inline=1` opens the PDF
 * in the browser instead of downloading it.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const result = await openQuoteDocument({ headers: req.headers, db }, id)
  if (!result.ok) {
    return Response.json(
      { error: result.message },
      { status: result.status, headers: { "cache-control": "no-store" } }
    )
  }
  const inline = req.nextUrl.searchParams.get("inline") === "1"
  return new Response(new Uint8Array(result.body), {
    headers: {
      "content-type": "application/pdf",
      "content-length": String(result.size),
      "content-disposition": contentDisposition(
        inline ? "inline" : "attachment",
        result.fileName
      ),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  })
}

function contentDisposition(type: "inline" | "attachment", fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "'")
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}
