import { defineConfig, devices } from "@playwright/test"

import { healthUrl } from "./support/urls"

/**
 * Smoke flows against the local stack (docker compose services + the app on
 * every `*.<ROOT_DOMAIN>` subdomain). There is no baseURL: each flow visits
 * absolute surface URLs (`app.`, `acme.`) built by `support/urls.ts`.
 * `pnpm test:e2e` from the repo root runs it with the root `.env` loaded.
 */
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    // A production build is what the flows exercise; a dev server (or any
    // app already listening on PORT) is reused instead when one is running.
    command:
      "pnpm --dir .. --filter web build && pnpm --dir .. --filter web start",
    url: healthUrl(),
    reuseExistingServer: !process.env.CI,
    timeout: 600_000,
    stdout: "ignore",
    stderr: "pipe",
  },
})
