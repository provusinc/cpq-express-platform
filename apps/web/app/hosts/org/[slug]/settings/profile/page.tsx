import type { Metadata } from "next"

import { ProfileSettings } from "@/components/settings/profile-settings"
import { HydrateClient, prefetch, trpc } from "@/trpc/server"

export const metadata: Metadata = {
  title: "Organization profile · Settings · CPQ Express",
}

export default function ProfileSettingsPage() {
  prefetch(trpc.settings.profile.queryOptions())
  return (
    <HydrateClient>
      <ProfileSettings />
    </HydrateClient>
  )
}
