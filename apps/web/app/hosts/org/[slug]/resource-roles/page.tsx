import type { Metadata } from "next"

import { CsvImportButton } from "@/components/catalog/csv-import-dialog"
import { INITIAL_RESOURCE_ROLE_LIST_INPUT } from "@/components/resource-roles/list-input"
import { ResourceRolesList } from "@/components/resource-roles/resource-roles-list"
import { organizationAccess } from "@/lib/organization-access"
import { HydrateClient, prefetch, trpc } from "@/trpc/server"

export const metadata: Metadata = { title: "Resource Roles · CPQ Express" }

export default async function ResourceRolesPage() {
  const access = await organizationAccess("catalog.manage")
  prefetch(
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
