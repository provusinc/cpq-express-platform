import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

import { ORGANIZATION_SLUG_HEADER } from "@workspace/api/headers"

import { env } from "@/env"
import {
  HOSTS_PREFIX,
  internalPath,
  REQUEST_PATH_HEADER,
  resolveHost,
} from "@/lib/hosts"

/**
 * Host-based routing: rewrites each subdomain to its route tree under
 * `app/hosts/` (see lib/hosts.ts). Host header only — no database, no
 * session checks; authorization happens in the server layer.
 *
 * It also stamps every request (pages and `/api/*`) with the Organization
 * slug of its subdomain in `x-organization-slug`, replacing any value the
 * client sent, so the tRPC context (route handler and RSC caller alike)
 * knows which Organization the request is for.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  // The internal prefixes are only reachable through a rewrite.
  if (pathname === HOSTS_PREFIX || pathname.startsWith(`${HOSTS_PREFIX}/`)) {
    return notFound()
  }

  const surface = resolveHost(request.headers.get("host"), env.ROOT_DOMAIN)
  const headers = new Headers(request.headers)
  headers.delete(ORGANIZATION_SLUG_HEADER)
  if (surface.kind === "organization") {
    headers.set(ORGANIZATION_SLUG_HEADER, surface.slug)
  }
  headers.set(REQUEST_PATH_HEADER, `${pathname}${search}`)

  // The shared API is never rewritten, but a reserved or malformed host
  // doesn't serve it either.
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    if (surface.kind === "unknown") return notFound()
    return NextResponse.next({ request: { headers } })
  }

  const target = internalPath(surface, pathname)
  if (target === "not-found") return notFound()
  if (target === null) return NextResponse.next({ request: { headers } })
  return NextResponse.rewrite(new URL(`${target}${search}`, request.url), {
    request: { headers },
  })
}

function notFound() {
  return new NextResponse("Not found", {
    status: 404,
    headers: { "content-type": "text/plain" },
  })
}

export const config = {
  // Everything except Next internals and static files. `/api/*` is included
  // only to stamp the Organization slug header; it is never rewritten.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)",
  ],
}
