/**
 * Host → surface resolution for `proxy.ts`. Pure and Host-header-only: it
 * never touches the database (ADR-0001). Each surface's routes live under an
 * internal path prefix in `app/hosts/`, which the proxy rewrites to:
 *
 *   app.<ROOT_DOMAIN>/x      →  /hosts/app/x       sign-in, check-email, home
 *   (#4) admin.<ROOT_DOMAIN> →  /hosts/admin/x     Platform Admin console
 *   (#4) {slug}.<ROOT_DOMAIN>→  /hosts/org/{slug}/x Organization
 *
 * Any other host (the bare root domain, localhost) is passed through
 * untouched. `/api/*` is shared by every host and never rewritten.
 */
export type HostSurface = { kind: "app" } | { kind: "other" }

/** Internal route prefix of every surface's routes (never addressable directly). */
export const HOSTS_PREFIX = "/hosts"

export function resolveHost(
  host: string | null,
  rootDomain: string
): HostSurface {
  const hostname = (host ?? "").split(":")[0]!.toLowerCase()
  const root = rootDomain.toLowerCase()
  if (hostname === `app.${root}`) return { kind: "app" }
  return { kind: "other" }
}

/** The internal path a request on `surface` is served from, or null to pass through. */
export function internalPath(surface: HostSurface, pathname: string) {
  switch (surface.kind) {
    case "app":
      return `${HOSTS_PREFIX}/app${pathname === "/" ? "" : pathname}`
    case "other":
      return null
  }
}
