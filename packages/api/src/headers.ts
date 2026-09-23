/**
 * Request headers the API reads. Dependency-free so `apps/web/proxy.ts` can
 * import it (`@workspace/api/headers`) without pulling in the server code.
 */

/**
 * The Organization slug of the request's subdomain. `apps/web/proxy.ts` sets
 * it from the Host header on every request to `{slug}.<ROOT_DOMAIN>` (and
 * strips any client-sent value elsewhere); `organizationProcedure` reads it.
 * Tests set it directly (`organizationCaller`).
 */
export const ORGANIZATION_SLUG_HEADER = "x-organization-slug"
