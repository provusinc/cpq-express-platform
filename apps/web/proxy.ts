import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

import { env } from "@/env"
import { HOSTS_PREFIX, internalPath, resolveHost } from "@/lib/hosts"

/**
 * Host-based routing: rewrites each subdomain to its route tree under
 * `app/hosts/` (see lib/hosts.ts). Host header only — no database, no
 * session checks; authorization happens in the server layer.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  // The internal prefixes are only reachable through a rewrite.
  if (pathname === HOSTS_PREFIX || pathname.startsWith(`${HOSTS_PREFIX}/`)) {
    return new NextResponse(null, { status: 404 })
  }

  const surface = resolveHost(request.headers.get("host"), env.ROOT_DOMAIN)
  const target = internalPath(surface, pathname)
  if (!target) return NextResponse.next()
  return NextResponse.rewrite(new URL(`${target}${search}`, request.url))
}

export const config = {
  // Everything except the shared API, Next internals and static files.
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)",
  ],
}
