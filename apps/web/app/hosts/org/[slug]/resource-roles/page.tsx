import type { Metadata } from "next"

import { CsvImportButton } from "@/components/catalog/csv-import-dialog"
import { INITIAL_RESOURCE_ROLE_LIST_INPUT } from "@/components/resource-roles/list-input"
import { ResourceRolesList } from "@/components/resource-roles/resource-roles-list"
import { getLabels } from "@/components/shell/get-labels"
import { organizationAccess } from "@/lib/organization-access"
import { HydrateClient, prefetch, prefetchNow, trpc } from "@/trpc/server"

export async function generateMetadata(): Promise<Metadata> {
  const { resource_role } = await getLabels()
  return { title: `${resource_role.plural} · CPQ Express` }
}

export default async function ResourceRolesPage() {
  const access = await organizationAccess("catalog.manage")
  // The list reads it with `useQuery`: settle it before rendering.
  await prefetchNow(
    trpc.resourceRole.list.queryOptions(INITIAL_RESOURCE_ROLE_LIST_INPUT)
  )
  prefetch(trpc.resourceRole.locations.queryOptions())
  return (
    <HydrateClient>
      <ResourceRolesList
        canManage={access.allowed}
        currencyCode={access.currencyCode}
        toolbar={<CsvImportButton target={{ type: "resourceRoles" }} />}
      />
    </HydrateClient>
  )
}
