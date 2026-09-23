import { defineConfig } from "vitest/config"

// Env comes from the root .env (`pnpm test` runs through `pnpm with-env`).
// DATABASE_URL is forced to the test database so nothing can reach dev data.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: ["./src/test/global-setup.ts"],
    setupFiles: ["./src/test/setup.ts"],
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? "" },
  },
})
