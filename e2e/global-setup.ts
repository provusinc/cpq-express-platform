import { execSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { MAILPIT_URL } from "./support/urls"

/**
 * Resets the seeded demo data (idempotent upsert) so every run starts from
 * known Users, Accounts and catalog, and checks Mailpit is reachable (the
 * magic links arrive there).
 */
export default async function globalSetup() {
  const root = fileURLToPath(new URL("..", import.meta.url))
  execSync("pnpm db:seed", { cwd: root, stdio: "inherit" })

  const response = await fetch(`${MAILPIT_URL}/api/v1/info`).catch(() => null)
  if (!response?.ok) {
    throw new Error(
      `Mailpit isn't reachable at ${MAILPIT_URL}. Start the services with \`pnpm services:up\`.`
    )
  }
}
