import { redirect } from "next/navigation"

import { SETTINGS_TABS } from "@/components/settings/tabs"

/** `/settings` opens the first tab. */
export default function SettingsPage() {
  redirect(SETTINGS_TABS[0].href)
}
