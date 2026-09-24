# Subdomain multi-tenancy on a shared Postgres schema

Each Organization is reached at `{slug}.<ROOT_DOMAIN>`; all Organizations share one Postgres
schema, with `organization_id` on every business table and composite foreign keys
(`(organization_id, id)`) so a row can never reference another Organization's row. Users are
global (one Auth.js identity), belong to Organizations through Memberships, and sign in once on
a reserved `app.` subdomain with a session cookie scoped to `.<ROOT_DOMAIN>`; authorization is
re-checked per subdomain against the Membership. We chose this over schema-/database-per-tenant
because migrations, Drizzle Kit, and Platform Admin provisioning stay single-path, and the
current Salesforce model (one customer org = one tenant, one person may work across several)
maps onto it directly.

## Consequences

- `proxy.ts` rewrites by Host header only (no DB); the Organization lookup and Membership check
  happen in the server layer, and every data access goes through an Organization-scoped context.
- Slugs are immutable in v1; `app`, `admin`, `www`, `api`, `auth`, `docs`, `status` are reserved.
- Custom domains and Postgres RLS are deferred; RLS can be layered on later without schema change.
