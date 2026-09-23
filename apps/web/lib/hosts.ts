/**
 * Host → surface resolution for `proxy.ts`. Pure and Host-header-only: it
 * never touches the database (ADR-0001). Each surface's routes live under an
 * internal path prefix in `app/hosts/`, which the proxy rewrites to:
 *
 *   app.<ROOT_DOMAIN>/x     →  /hosts/app/x          sign-in, Organization picker
 *   admin.<ROOT_DOMAIN>/x   →  /hosts/admin/x        Platform Admin console
 *   {slug}.<ROOT_DOMAIN>/x  →  /hosts/org/{slug}/x   an Organization
 *
 * Reserved subdomains (`www`, `api`, …), nested subdomains and labels that
 * can't be a slug are `unknown` (404). Whether an Organization with a
 * well-formed slug exists is decided later, by the server layer. Any other
 * host (the bare root domain, `localhost`) is passed through untouched.
 * `/api/*` is shared by every host and never rewritten.
 */
export type HostSurface =
  | { kind: "app" }
  | { kind: "admin" }
  | { kind: "organization"; slug: string }
  | { kind: "unknown" }
  | { kind: "other" }

/**
 * Request header the proxy sets to the original public path + query (before
 * the rewrite), so server components can build a sign-in `callbackUrl`.
 */
export const REQUEST_PATH_HEADER = "x-request-path"

/** Internal route prefix of every surface's routes (never addressable directly). */
export const HOSTS_PREFIX = "/hosts"

/**
 * Subdomains that are never an Organization. Must match `RESERVED_SLUGS` in
 * `@workspace/db` (the database check constraint); both move to
 * `@workspace/domain` with the slug rules.
 */
export const RESERVED_SUBDOMAINS: readonly string[] = [
  "app",
  "admin",
  "www",
  "api",
  "auth",
  "docs",
  "status",
]

/** A DNS label: lowercase letters, digits and inner hyphens, 1–63 chars. */
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

export function resolveHost(
  host: string | null,
  rootDomain: string
): HostSurface {
  const hostname = (host ?? "").split(":")[0]!.toLowerCase()
  const root = rootDomain.toLowerCase()
  if (!hostname.endsWith(`.${root}`)) return { kind: "other" }

  const subdomain = hostname.slice(0, -(root.length + 1))
  if (subdomain === "app") return { kind: "app" }
  if (subdomain === "admin") return { kind: "admin" }
  if (RESERVED_SUBDOMAINS.includes(subdomain) || !SLUG.test(subdomain)) {
    return { kind: "unknown" }
  }
  return { kind: "organization", slug: subdomain }
}

/**
 * The internal path a request on `surface` is served from; null to pass it
 * through untouched, `"not-found"` for a 404.
 */
export function internalPath(
  surface: HostSurface,
  pathname: string
): string | null | "not-found" {
  const rest = pathname === "/" ? "" : pathname
  switch (surface.kind) {
    case "app":
      return `${HOSTS_PREFIX}/app${rest}`
    case "admin":
      return `${HOSTS_PREFIX}/admin${rest}`
    case "organization":
      return `${HOSTS_PREFIX}/org/${surface.slug}${rest}`
    case "unknown":
      return "not-found"
    case "other":
      return null
  }
}

/**
 * Public origin of a surface, built from APP_URL's scheme and port:
 * `surfaceOrigin("http://app.localtest.me:3000", "localtest.me", { kind: "organization", slug: "acme" })`
 * → `http://acme.localtest.me:3000`.
 */
export function surfaceOrigin(
  appUrl: string,
  rootDomain: string,
  surface:
    | { kind: "app" }
    | { kind: "admin" }
    | { kind: "organization"; slug: string }
) {
  const url = new URL(appUrl)
  const subdomain =
    surface.kind === "organization" ? surface.slug : surface.kind
  url.hostname = `${subdomain}.${rootDomain}`
  return url.origin
}
